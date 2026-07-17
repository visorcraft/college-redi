import { exec, rows } from './store';

export interface CollegeEmailDigestItem {
  id: string;
  subject: string;
  from_addr: string;
  summary: string | null;
  received_at: string;
}

const sqlString = (value: string): string => `'${value.replace(/'/g, "''")}'`;

/** Return unsurfaced informational email, oldest first, capped at 50. */
export async function collectCollegeEmailDigestItems(
  opts: { markIncluded?: boolean } = {},
): Promise<CollegeEmailDigestItem[]> {
  const items = await rows<CollegeEmailDigestItem>(
    `SELECT id, subject, from_addr, summary, received_at FROM emails_processed
     WHERE classification = 'informational' AND notified = FALSE
     ORDER BY received_at ASC LIMIT 50`,
  );
  if (opts.markIncluded && items.length > 0) {
    const ids = items.map((item) => sqlString(item.id)).join(', ');
    await exec(`UPDATE emails_processed SET notified = TRUE WHERE id IN (${ids})`);
  }
  return items;
}

export function renderCollegeEmailDigestSection(items: CollegeEmailDigestItem[]): string {
  if (items.length === 0) return '';
  const lines = [
    `📬 College inbox — ${items.length} informational email${items.length === 1 ? '' : 's'}:`,
  ];
  for (const item of items) {
    lines.push(`• ${item.subject} — ${item.summary ?? '(no summary)'}`);
  }
  return lines.join('\n');
}
