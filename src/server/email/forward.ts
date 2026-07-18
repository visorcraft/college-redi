import { enqueueNotification } from '../notify/engine';
import { getSettings } from '../settings';
import type { ExtractedEventRow } from './store';

export interface ForwardableEmail {
  id: string;
  subject: string;
  from_addr: string;
  summary: string | null;
}

function formatInTimezone(iso: string, timezone: string): string {
  try {
    return new Date(iso).toLocaleString('en-US', {
      timeZone: timezone,
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

/** Send only a summary and extracted actions. Never forward the raw email body. */
export async function forwardActionableSummary(
  email: ForwardableEmail,
  events: ExtractedEventRow[],
  importance: 'low' | 'normal' | 'urgent',
  now: Date,
): Promise<string> {
  const timezone = (await getSettings()).timezone ?? 'UTC';
  const oneLine = (email.summary ?? email.subject).split('\n')[0].slice(0, 80);
  const lines = [email.summary ?? `Important email from ${email.from_addr}: ${email.subject}`];
  if (events.length > 0) {
    lines.push('', 'What I found:');
    for (const event of events) {
      lines.push(
        `• ${event.title}${
          event.due_at
            ? ` - due ${formatInTimezone(event.due_at, timezone)}`
            : ' - date needs your confirmation'
        }`,
      );
    }
  }
  lines.push('', 'Open Redi to review: /email');
  return enqueueNotification({
    type: 'email_summary',
    title: `☁️ Redi: ${oneLine}`,
    body: lines.join('\n'),
    importance,
    channels: ['in_app', 'email'],
    scheduledFor: now,
    relatedType: 'email',
    relatedId: email.id,
  });
}
