import { describe, it, expect } from 'vitest';
import { buildBanners } from '@/lib/banners';

describe('buildBanners', () => {
  it('maps skipped wizard steps to one-line banners with fix links', () => {
    const banners = buildBanners({ wizard_state: { skipped_steps: ['ai', 'twilio'] }, ui: { setup_dismissed: [] } }, null);
    expect(banners.map((b) => b.id)).toEqual(['skip:ai', 'skip:twilio']);
    expect(banners[0].href).toBe('/settings/ai');
    expect(banners[1].href).toBe('/settings/twilio');
  });

  it('hides dismissed banners (ui.setup_dismissed)', () => {
    const banners = buildBanners(
      { wizard_state: { skipped_steps: ['ai'] }, ui: { setup_dismissed: ['skip:ai'] } },
      null,
    );
    expect(banners).toEqual([]);
  });

  it('ignores unknown skipped-step ids', () => {
    const banners = buildBanners({ wizard_state: { skipped_steps: ['mystery'] }, ui: {} }, null);
    expect(banners).toEqual([]);
  });

  it('surfaces failed channels from get_system_status', () => {
    const status = {
      imap: { configured: true, last_error: 'Invalid credentials' },
      ai: { configured: true, reachable: true },
    };
    const banners = buildBanners({ wizard_state: { skipped_steps: [] }, ui: {} }, status);
    expect(banners).toEqual([
      { id: 'channel:imap', text: 'College email login needs attention: Invalid credentials', href: '/settings/imap' },
    ]);
  });

  it('hides stale checklist and transient AI health banners', () => {
    const banners = buildBanners(
      {
        wizard_state: {
          skipped_steps: ['checklist'],
          pending_checklist: [{ title: 'Send transcript' }],
        },
        ui: {},
      },
      { ai: { configured: true, reachable: false, error: 'Request timed out.' } },
    );
    expect(banners).toEqual([]);
  });

  it('surfaces exhausted email and text deliveries', () => {
    const banners = buildBanners(
      { wizard_state: { skipped_steps: [] }, ui: {} },
      {
        smtp: {
          configured: true,
          last_delivery_error: 'A scheduled email failed after all retries.',
        },
        twilio: {
          configured: true,
          last_delivery_error: 'A scheduled text message failed after all retries.',
        },
      },
    );
    expect(banners.map((banner) => banner.id))
      .toEqual(['channel:smtp', 'channel:twilio']);
  });

  it('falls back to imap.last_error when status is unavailable, without duplicating', () => {
    const settings = { wizard_state: { skipped_steps: [] }, ui: {}, imap: { last_error: 'AUTH failed' } };
    expect(buildBanners(settings, null).map((b) => b.id)).toEqual(['channel:imap']);
    const withChecks = buildBanners(settings, {
      imap: { configured: true, last_error: 'AUTH failed' },
    });
    expect(withChecks.filter((b) => b.id === 'channel:imap')).toHaveLength(1);
  });

  it('tolerates any status shape without crashing', () => {
    expect(buildBanners({ wizard_state: { skipped_steps: [] }, ui: {} }, 'garbage')).toEqual([]);
    expect(buildBanners({ wizard_state: { skipped_steps: [] }, ui: {} }, { ai: 'nope' })).toEqual([]);
  });
});
