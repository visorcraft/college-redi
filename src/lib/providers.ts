export interface ProviderPreset {
  id: 'gmail' | 'outlook' | 'yahoo' | 'icloud' | 'other';
  label: string;
  imap: { host: string; port: number };
  smtp: { host: string; port: number; security: 'tls' | 'starttls' };
  passwordNote: string;
  helpUrl: string | null;
}

export const PROVIDERS: readonly ProviderPreset[] = [
  {
    id: 'gmail', label: 'Gmail',
    imap: { host: 'imap.gmail.com', port: 993 },
    smtp: { host: 'smtp.gmail.com', port: 465, security: 'tls' },
    passwordNote: 'Requires 2FA, then create an app password (not your normal Gmail password).',
    helpUrl: 'https://myaccount.google.com/apppasswords',
  },
  {
    id: 'outlook', label: 'Outlook / Microsoft 365',
    imap: { host: 'outlook.office365.com', port: 993 },
    smtp: { host: 'smtp.office365.com', port: 587, security: 'starttls' },
    passwordNote: 'Use an app password if 2FA is on.',
    helpUrl: 'https://account.live.com/proofs/AppPassword',
  },
  {
    id: 'yahoo', label: 'Yahoo',
    imap: { host: 'imap.mail.yahoo.com', port: 993 },
    smtp: { host: 'smtp.mail.yahoo.com', port: 465, security: 'tls' },
    passwordNote: 'An app password is required — your normal password will not work.',
    helpUrl: 'https://login.yahoo.com/account/security',
  },
  {
    id: 'icloud', label: 'iCloud',
    imap: { host: 'imap.mail.me.com', port: 993 },
    smtp: { host: 'smtp.mail.me.com', port: 587, security: 'starttls' },
    passwordNote: 'An app-specific password is required (appleid.apple.com → Sign-In and Security).',
    helpUrl: 'https://appleid.apple.com',
  },
  {
    id: 'other', label: 'Other / school',
    imap: { host: '', port: 993 },
    smtp: { host: '', port: 587, security: 'starttls' },
    passwordNote: 'School SSO portals often document "IMAP/SMTP access" separately — check your IT page for host names and app passwords.',
    helpUrl: null,
  },
];

export function providerById(id: string): ProviderPreset {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[PROVIDERS.length - 1];
}
