import type { Tool } from './registry';
import { ConfirmRequiredError, ToolError } from './errors';
import { def } from './degree';
import { DeleteTermParams, ListTermsParams, UpsertTermParams } from '../../lib/schemas/degree';
import {
  TERM_COLS, deleteWhere, getTermOrThrow, insertRow, lit, newId, sqlAll, sqlOne, updateRow,
  type TermRow,
} from '../degree/repo';

const normTs = (v: string | null): string | null => (v ? new Date(v).toISOString() : null);

const list_terms = def({
  name: 'list_terms',
  description: 'List all terms ordered by classes_start.',
  sideEffect: 'read',
  paramsSchema: ListTermsParams,
  handler: () => sqlAll<TermRow>(`SELECT ${TERM_COLS} FROM terms ORDER BY classes_start`),
});

const upsert_term = def({
  name: 'upsert_term',
  description: 'Create or update a term and its key dates. With id: update by id. Without id: update the term with the same name, else insert. Nullable date fields are only touched when provided.',
  sideEffect: 'write',
  paramsSchema: UpsertTermParams,
  handler: async (p) => {
    const { id, ...f } = p;
    const opt = (v: string | null | undefined): string | null | undefined => (v === undefined ? undefined : normTs(v));
    const provided: Record<string, string | null | undefined> = {
      name: f.name,
      classes_start: f.classes_start,
      classes_end: f.classes_end,
      registration_opens_at: opt(f.registration_opens_at),
      registration_closes_at: opt(f.registration_closes_at),
      add_drop_deadline: opt(f.add_drop_deadline),
      tuition_due: opt(f.tuition_due),
      notes: f.notes,
    };
    if (id) {
      await getTermOrThrow(id);
      const clash = await sqlOne<TermRow>(`SELECT ${TERM_COLS} FROM terms WHERE name = ${lit(f.name)} AND id <> ${lit(id)}`);
      if (clash) throw new ToolError('conflict', `a term named "${f.name}" already exists`, 409);
      await updateRow('terms', id, provided);
      return getTermOrThrow(id);
    }
    const existing = await sqlOne<TermRow>(`SELECT ${TERM_COLS} FROM terms WHERE name = ${lit(f.name)}`);
    if (existing) {
      await updateRow('terms', existing.id, provided);
      return getTermOrThrow(existing.id);
    }
    const newTermId = newId();
    await insertRow('terms', {
      id: newTermId, name: f.name, classes_start: f.classes_start, classes_end: f.classes_end,
      registration_opens_at: provided.registration_opens_at ?? null,
      registration_closes_at: provided.registration_closes_at ?? null,
      add_drop_deadline: provided.add_drop_deadline ?? null,
      tuition_due: provided.tuition_due ?? null,
      notes: provided.notes ?? null,
    });
    return getTermOrThrow(newTermId);
  },
});

const delete_term = def({
  name: 'delete_term',
  description: 'Delete a term. Blocked while planned courses reference it. Requires confirm: true.',
  sideEffect: 'destructive',
  paramsSchema: DeleteTermParams,
  handler: async (p) => {
    if (p.confirm !== true) throw new ConfirmRequiredError('delete_term');
    const term = await getTermOrThrow(p.id);
    const ref = await sqlOne<{ n: number }>(`SELECT COUNT(*) AS n FROM planned_courses WHERE term_id = ${lit(p.id)}`);
    if ((ref?.n ?? 0) > 0) throw new ToolError('conflict', `term "${term.name}" still has ${ref!.n} planned course(s)`, 409);
    await deleteWhere('terms', `id = ${lit(p.id)}`);
    return { deleted: true, id: p.id };
  },
});

export const termsTools = [list_terms, upsert_term, delete_term] as Tool[];
