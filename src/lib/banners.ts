export interface Banner { id: string; text: string; href: string }

// One-line, friendly, one-click fix (spec §5.2: banners, never modals).
export const SKIPPED_STEP_BANNERS: Record<string, { text: string; href: string }> = {
  ai: { text: 'Redi is sleepy — add your AI key so he can think and chat.', href: '/settings/ai' },
  imap: { text: 'College email is not connected — Redi cannot watch your inbox yet.', href: '/settings/imap' },
  smtp: { text: 'Personal email is not set up — summaries have nowhere to go.', href: '/settings/smtp' },
  twilio: { text: 'Text messages are off — optional, but handy for urgent nudges.', href: '/settings/twilio' },
  degree: { text: 'Your degree plan is empty — import your audit or add courses.', href: '/degree' },
  checklist: { text: 'No starting checklist — add the paperwork you still owe.', href: '/tasks' },
  notifications: { text: 'Notification style is not set — quiet hours and digest live here.', href: '/settings/notifications' },
};

const CHANNEL_BANNERS: Record<string, { label: string; href: string }> = {
  ai: { label: 'The AI provider', href: '/settings/ai' },
  imap: { label: 'College email login', href: '/settings/imap' },
  smtp: { label: 'Personal email sending', href: '/settings/smtp' },
  twilio: { label: 'Text messages', href: '/settings/twilio' },
};

interface BannerSettings {
  wizard_state?: { skipped_steps?: string[] };
  ui?: { setup_dismissed?: string[] };
  imap?: { last_error?: string | null };
}

export function buildBanners(settings: BannerSettings, status: unknown): Banner[] {
  const dismissed = new Set(settings.ui?.setup_dismissed ?? []);
  const seen = new Set<string>();
  const out: Banner[] = [];
  const push = (b: Banner) => {
    if (!dismissed.has(b.id) && !seen.has(b.id)) {
      seen.add(b.id);
      out.push(b);
    }
  };

  for (const step of settings.wizard_state?.skipped_steps ?? []) {
    const meta = SKIPPED_STEP_BANNERS[step];
    if (meta) push({ id: `skip:${step}`, ...meta });
  }

  const checks = status && typeof status === 'object'
    ? status as Record<string, {
        configured?: boolean;
        reachable?: boolean;
        valid?: boolean;
        last_error?: string | null;
        last_delivery_error?: string | null;
        error?: string;
      }>
    : {};
  for (const [name, check] of Object.entries(checks)) {
    if (check && typeof check === 'object') {
      const failed = name === 'ai'
        ? check.configured !== false && check.reachable === false
        : name === 'imap'
          ? Boolean(check.last_error)
          : check.configured !== false
            && (check.valid === false || Boolean(check.last_delivery_error));
      if (failed) {
      const meta = CHANNEL_BANNERS[name];
      if (meta) {
        push({
          id: `channel:${name}`,
          text: `${meta.label} needs attention${
            check.error || check.last_error || check.last_delivery_error
              ? `: ${check.error ?? check.last_error ?? check.last_delivery_error}`
              : '.'
          }`,
          href: meta.href,
        });
      }
    }
  }
  }

  // Fallback when status is unavailable: the persisted last IMAP poll error.
  const imapError = settings.imap?.last_error;
  if (imapError) {
    push({ id: 'channel:imap', text: `College email login needs attention: ${imapError}`, href: '/settings/imap' });
  }

  return out;
}
