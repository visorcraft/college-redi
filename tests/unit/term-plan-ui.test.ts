import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/components/degree/TermPlan.tsx', 'utf8');

describe('term plan UI', () => {
  it('captures and displays every term deadline and notes', () => {
    for (const name of [
      'registration_opens_at',
      'registration_closes_at',
      'add_drop_deadline',
      'tuition_due',
      'notes',
    ]) {
      expect(source).toContain(`name="${name}"`);
    }

    for (const label of [
      'Registration opens',
      'Registration closes',
      'Add/drop deadline',
      'Tuition due',
      'Notes',
    ]) {
      expect(source).toContain(label);
    }
  });

  it('edits and confirms deletion through the existing term API', () => {
    expect(source).toContain('aria-label={`edit term ${term.name}`}');
    expect(source).toContain('await patch(`/api/terms/${term.id}`, termPayload(');
    expect(source).toContain('window.confirm(`Delete ${term.name}?`)');
    expect(source).toContain('await del(`/api/terms/${term.id}`, { confirm: true })');
  });
});
