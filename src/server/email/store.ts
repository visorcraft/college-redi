import { randomUUID } from 'node:crypto';
import { lit, sqlExec, sqlRows, withSqlTransaction } from '../db/sql';

export const rows = sqlRows;
export const exec = sqlExec;

export async function withTransaction<T>(fn: () => Promise<T>): Promise<T> {
  return withSqlTransaction(fn);
}

const num = (value: unknown): number =>
  typeof value === 'bigint' ? Number(value) : Number(value ?? 0);

export interface ProcessedEmailRow {
  id: string;
  mailbox: string;
  uid: number;
  uidvalidity: number;
  message_id: string;
  from_addr: string;
  subject: string;
  received_at: string;
  classification: 'junk' | 'informational' | 'actionable' | 'unprocessed';
  summary: string | null;
  extracted_count: number;
  notified: boolean;
  processed_at: string | null;
}

export interface ExtractedEventRow {
  id: string;
  email_id: string;
  title: string;
  event_type: string;
  due_at: string | null;
  confidence: number;
  status: 'pending_review' | 'accepted' | 'dismissed';
  task_id: string | null;
  created_at: string;
}

export interface SenderRuleRow {
  id: string;
  pattern: string;
  action: 'junk' | 'important';
  created_at: string;
}

export interface JobLeaseRow {
  job_name: string;
  locked_until: string | null;
  last_run_at: string | null;
  last_status: string | null;
}

const mapEmail = (row: Record<string, unknown>): ProcessedEmailRow => ({
  ...row,
  uid: num(row.uid),
  uidvalidity: num(row.uidvalidity),
  extracted_count: num(row.extracted_count),
  notified: row.notified === true || row.notified === 1,
}) as ProcessedEmailRow;

const mapEvent = (row: Record<string, unknown>): ExtractedEventRow => ({
  ...row,
  confidence: Number(row.confidence),
}) as ExtractedEventRow;

export async function findProcessedByUid(
  mailbox: string,
  uidvalidity: number,
  uid: number,
): Promise<ProcessedEmailRow | null> {
  const found = await rows<Record<string, unknown>>(
    `SELECT * FROM emails_processed WHERE mailbox = ${lit(mailbox)} AND uidvalidity = ${uidvalidity} AND uid = ${uid} LIMIT 1`,
  );
  return found[0] ? mapEmail(found[0]) : null;
}

export async function findProcessedByMessageId(messageId: string): Promise<ProcessedEmailRow | null> {
  if (!messageId) return null;
  const found = await rows<Record<string, unknown>>(
    `SELECT * FROM emails_processed WHERE message_id = ${lit(messageId)} LIMIT 1`,
  );
  return found[0] ? mapEmail(found[0]) : null;
}

export async function getProcessedEmail(id: string): Promise<ProcessedEmailRow | null> {
  const found = await rows<Record<string, unknown>>(
    `SELECT * FROM emails_processed WHERE id = ${lit(id)} LIMIT 1`,
  );
  return found[0] ? mapEmail(found[0]) : null;
}

export async function insertProcessedEmail(
  row: Omit<ProcessedEmailRow, 'id'> & { id?: string },
): Promise<string> {
  const id = row.id ?? randomUUID();
  await exec(
    `INSERT INTO emails_processed (id, mailbox, uid, uidvalidity, message_id, from_addr, subject, received_at, classification, summary, extracted_count, notified, processed_at)
     VALUES (${lit(id)}, ${lit(row.mailbox)}, ${row.uid}, ${row.uidvalidity}, ${lit(row.message_id)}, ${lit(row.from_addr)}, ${lit(row.subject)}, ${lit(row.received_at)}, ${lit(row.classification)}, ${lit(row.summary)}, ${row.extracted_count}, ${lit(row.notified)}, ${lit(row.processed_at)})`,
  );
  return id;
}

const EMAIL_PATCH_COLUMNS = [
  'classification',
  'summary',
  'extracted_count',
  'notified',
  'processed_at',
  'uidvalidity',
] as const;

export async function updateProcessedEmail(
  id: string,
  patch: Partial<ProcessedEmailRow>,
): Promise<void> {
  const sets = EMAIL_PATCH_COLUMNS
    .filter((key) => key in patch)
    .map((key) => `${key} = ${lit(patch[key] as string | number | boolean | null)}`);
  if (sets.length > 0) {
    await exec(`UPDATE emails_processed SET ${sets.join(', ')} WHERE id = ${lit(id)}`);
  }
}

export async function listProcessedEmails(filter: {
  classification?: string;
  since?: string;
  limit: number;
  offset: number;
}): Promise<{ emails: ProcessedEmailRow[]; total: number }> {
  const where: string[] = [];
  if (filter.classification) where.push(`classification = ${lit(filter.classification)}`);
  if (filter.since) where.push(`received_at >= ${lit(filter.since)}`);
  const clause = where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '';
  const emails = (await rows<Record<string, unknown>>(
    `SELECT * FROM emails_processed${clause} ORDER BY received_at DESC, uid DESC LIMIT ${filter.limit} OFFSET ${filter.offset}`,
  )).map(mapEmail);
  const total = num((await rows<{ n: number }>(
    `SELECT COUNT(*) AS n FROM emails_processed${clause}`,
  ))[0]?.n);
  return { emails, total };
}

export async function insertExtractedEvent(ev: {
  id?: string;
  email_id: string;
  title: string;
  event_type: string;
  due_at: string | null;
  confidence: number;
  status: string;
  task_id: string | null;
  created_at?: string;
}): Promise<string> {
  const id = ev.id ?? randomUUID();
  const createdAt = ev.created_at ?? new Date().toISOString();
  await exec(
    `INSERT INTO extracted_events (id, email_id, title, event_type, due_at, confidence, status, task_id, created_at)
     VALUES (${lit(id)}, ${lit(ev.email_id)}, ${lit(ev.title)}, ${lit(ev.event_type)}, ${lit(ev.due_at)}, ${ev.confidence}, ${lit(ev.status)}, ${lit(ev.task_id)}, ${lit(createdAt)})`,
  );
  return id;
}

export async function getExtractedEvent(id: string): Promise<ExtractedEventRow | null> {
  const found = await rows<Record<string, unknown>>(
    `SELECT * FROM extracted_events WHERE id = ${lit(id)} LIMIT 1`,
  );
  return found[0] ? mapEvent(found[0]) : null;
}

export async function updateExtractedEvent(
  id: string,
  patch: Partial<ExtractedEventRow>,
): Promise<void> {
  const keys = ['title', 'event_type', 'due_at', 'confidence', 'status', 'task_id'] as const;
  const sets = keys
    .filter((key) => key in patch)
    .map((key) => `${key} = ${lit(patch[key] as string | number | null)}`);
  if (sets.length > 0) {
    await exec(`UPDATE extracted_events SET ${sets.join(', ')} WHERE id = ${lit(id)}`);
  }
}

export async function deleteExtractedEventsForEmail(emailId: string): Promise<void> {
  await exec(`DELETE FROM extracted_events WHERE email_id = ${lit(emailId)}`);
}

export async function cancelPendingEmailSummaries(emailId: string): Promise<void> {
  await exec(
    `UPDATE notifications SET status = 'cancelled' ` +
    `WHERE type = 'email_summary' AND related_type = 'email' ` +
    `AND related_id = ${lit(emailId)} AND status = 'pending'`,
  );
}

export interface ExtractedEventWithEmail extends ExtractedEventRow {
  email_subject: string;
  email_from: string;
}

export async function listExtractedEvents(filter: {
  status?: string;
  limit: number;
  offset: number;
}): Promise<ExtractedEventWithEmail[]> {
  const where = filter.status ? `WHERE e.status = ${lit(filter.status)}` : '';
  const found = await rows<Record<string, unknown>>(
    `SELECT e.*, p.subject AS email_subject, p.from_addr AS email_from
     FROM extracted_events e JOIN emails_processed p ON p.id = e.email_id ${where}
     ORDER BY e.created_at DESC LIMIT ${filter.limit} OFFSET ${filter.offset}`,
  );
  return found.map((row) => ({
    ...mapEvent(row),
    email_subject: String(row.email_subject),
    email_from: String(row.email_from),
  }));
}

export async function listExtractedEventsForEmail(
  emailId: string,
): Promise<ExtractedEventRow[]> {
  const found = await rows<Record<string, unknown>>(
    `SELECT * FROM extracted_events WHERE email_id = ${lit(emailId)} ORDER BY created_at ASC`,
  );
  return found.map(mapEvent);
}

export async function listSenderRules(): Promise<SenderRuleRow[]> {
  return rows<SenderRuleRow>('SELECT * FROM sender_rules ORDER BY created_at ASC');
}

export async function findSenderRuleByPattern(pattern: string): Promise<SenderRuleRow | null> {
  const found = await rows<SenderRuleRow>(
    `SELECT * FROM sender_rules WHERE pattern = ${lit(pattern)} LIMIT 1`,
  );
  return found[0] ?? null;
}

export async function insertSenderRule(rule: {
  pattern: string;
  action: 'junk' | 'important';
}): Promise<SenderRuleRow> {
  const row: SenderRuleRow = {
    id: randomUUID(),
    pattern: rule.pattern,
    action: rule.action,
    created_at: new Date().toISOString(),
  };
  await exec(
    `INSERT INTO sender_rules (id, pattern, action, created_at) VALUES (${lit(row.id)}, ${lit(row.pattern)}, ${lit(row.action)}, ${lit(row.created_at)})`,
  );
  return row;
}

export async function deleteSenderRule(id: string): Promise<boolean> {
  const found = await rows<{ id: string }>(
    `SELECT id FROM sender_rules WHERE id = ${lit(id)} LIMIT 1`,
  );
  if (!found[0]) return false;
  await exec(`DELETE FROM sender_rules WHERE id = ${lit(id)}`);
  return true;
}

export async function getJobLease(jobName: string): Promise<JobLeaseRow | null> {
  const found = await rows<JobLeaseRow>(
    `SELECT * FROM job_leases WHERE job_name = ${lit(jobName)} LIMIT 1`,
  );
  return found[0] ?? null;
}

export async function upsertJobLease(lease: {
  job_name: string;
  locked_until: string | null;
  last_run_at: string;
  last_status: string;
}): Promise<void> {
  if (await getJobLease(lease.job_name)) {
    await exec(
      `UPDATE job_leases SET locked_until = ${lit(lease.locked_until)}, last_run_at = ${lit(lease.last_run_at)}, last_status = ${lit(lease.last_status)} WHERE job_name = ${lit(lease.job_name)}`,
    );
    return;
  }
  await exec(
    `INSERT INTO job_leases (job_name, locked_until, last_run_at, last_status) VALUES (${lit(lease.job_name)}, ${lit(lease.locked_until)}, ${lit(lease.last_run_at)}, ${lit(lease.last_status)})`,
  );
}
