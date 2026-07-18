import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('authenticated app shell and dashboard', () => {
  it('provides main destinations in a mobile-safe navigation row', () => {
    const source = readFileSync('src/components/AppNav.tsx', 'utf8');
    for (const href of ['/', '/tasks', '/degree', '/email', '/settings']) {
      expect(source).toContain(`'${href}'`);
    }
    expect(source).toContain('overflow-x-auto');
    expect(source).toContain('aria-label="Main navigation"');
    expect(source).toContain("usePathname() === '/wizard'");
    expect(readFileSync('src/app/layout.tsx', 'utf8'))
      .toContain('pollStatus={authenticated}');
    expect(readFileSync('src/components/redi/RediWidget.tsx', 'utf8'))
      .toContain('if (!pollStatus) return;');
    expect(readFileSync('src/components/redi/RediWidget.tsx', 'utf8'))
      .toContain("pathname === '/login'");
  });

  it('treats chat as modeless and restores focus to its launcher', () => {
    const chat = readFileSync('src/components/redi/ChatBubble.tsx', 'utf8');
    const widget = readFileSync('src/components/redi/RediWidget.tsx', 'utf8');
    expect(chat).not.toContain('aria-modal=');
    expect(chat).toContain('sleepyActionRef.current');
    expect(chat).toContain('returnFocusRef.current?.focus()');
    expect(widget).toContain('returnFocusRef={buttonRef}');
  });

  it('keeps dashboard cards in required order and removes milestone placeholder copy', () => {
    const source = readFileSync('src/app/page.tsx', 'utf8');
    const today = source.indexOf('<TodayCard />');
    const registration = source.indexOf('<DashboardRegistrationCard />');
    const degree = source.indexOf('<DashboardDegreeProgress />');
    const inbox = source.indexOf('<CollegeInboxCard />');
    const banners = source.indexOf('<SetupBanners />');
    expect(today).toBeGreaterThan(-1);
    expect(today).toBeLessThan(registration);
    expect(registration).toBeLessThan(degree);
    expect(degree).toBeLessThan(inbox);
    expect(inbox).toBeLessThan(banners);
    expect(source).not.toContain('next milestones');
    const cards = readFileSync(
      'src/components/dashboard/DashboardDegreeCards.tsx',
      'utf8',
    );
    expect(cards).toContain("callTool('get_degree_progress'");
    expect(cards).toContain("callTool('get_registration_status'");
    expect(cards).toContain('<ProgressRing progress={progress} />');
  });

  it('links every settings section from the settings landing page', () => {
    const source = readFileSync('src/app/settings/page.tsx', 'utf8');
    for (const path of [
      '/settings/ai',
      '/settings/imap',
      '/settings/smtp',
      '/settings/twilio',
      '/settings/notifications',
      '/settings/agent',
      '/settings/security',
      '/settings/status',
    ]) expect(source).toContain(path);
  });

  it('allows narrow email content to wrap instead of widening the viewport', () => {
    const source = readFileSync('src/app/email/page.tsx', 'utf8');
    expect(source).toContain('min-w-0 max-w-3xl');
    expect(source).toContain('flex-col gap-2 sm:flex-row');
    expect(source).toContain('flex-wrap gap-1');
    expect(source).toContain('break-all');
  });

  it('keeps degree details bound to the selected program during rapid switches', () => {
    const source = readFileSync('src/components/degree/DegreeDashboard.tsx', 'utf8');
    expect(source).toContain('const detailRequest = useRef(0)');
    expect(source).toContain('request !== detailRequest.current');
    expect(source).toContain('detailProgramId === programId');
    expect(source).toContain('onChange={(e) => chooseProgram(e.target.value)}');
    expect(source).not.toContain('await loadDetail(id)');
    const refresh = source.slice(
      source.indexOf('const refresh = useCallback'),
      source.indexOf('const openProgram = useCallback'),
    );
    const capture = refresh.indexOf('const generation = selectionGeneration.current');
    const wait = refresh.indexOf('const list = await loadPrograms()');
    const guard = refresh.indexOf('generation !== selectionGeneration.current');
    const commit = refresh.indexOf('setPrograms(list)');
    const load = refresh.indexOf('await loadDetail(nextId)');
    expect(source).toContain('selectedProgram.current = id');
    expect(source).toContain('selectionGeneration.current += 1');
    expect(refresh).toContain('const selectedId = selectedProgram.current');
    expect(capture).toBeLessThan(wait);
    expect(wait).toBeLessThan(guard);
    expect(guard).toBeLessThan(commit);
    expect(commit).toBeLessThan(load);
    expect(guard).toBeLessThan(load);
  });

  it('reserves mobile wizard footer space for the floating Redi button', () => {
    const source = readFileSync('src/components/wizard/WizardShell.tsx', 'utf8');
    expect(source).toContain('pr-20');
    expect(source).toContain('sm:pr-0');
    expect(source).toContain("localStorage.setItem(PRE_AUTH_STEP_KEY, '2')");
    expect(source).toContain('onComplete={onLoginComplete}');
  });

  it('keeps the imported degree editable and advances wizard setup after confirm', () => {
    const importFlow = readFileSync('src/components/degree/ImportFlow.tsx', 'utf8');
    const degreeStep = readFileSync('src/components/wizard/steps/DegreeStep.tsx', 'utf8');
    expect(importFlow).toContain('updateProgram');
    expect(importFlow).toContain('updateCourse');
    expect(importFlow).toContain('updateRequirement');
    expect(importFlow).toContain('Requirement subjects');
    expect(importFlow).toContain('Requirement course codes');
    expect(importFlow).toContain('Requirement number ranges');
    expect(importFlow).toContain('Object.values(rangeInputs)');
    expect(importFlow).toContain("if (key === 'requirements')");
    expect(importFlow).toContain("if (type !== 'credit_bucket')");
    expect(importFlow).toContain('Requirement minimum grade');
    expect(importFlow).toContain('Requirement sort order');
    expect(importFlow).toContain('Course description');
    expect(importFlow).toContain('Course prerequisites');
    expect(importFlow).toContain('Course typical terms');
    expect(readFileSync('src/components/degree/ManualBuilder.tsx', 'utf8'))
      .toContain('if (ranges === null)');
    expect(importFlow).toContain('DegreeImportDraftSchema.safeParse(draft)');
    expect(importFlow).toContain('updateCompleted');
    expect(degreeStep).toContain('<DegreeImportSlot onConfirmed={imported} />');
    expect(degreeStep).toContain('await onComplete({ degree_profile: profile })');
  });

  it('shows readable live health, TLS, and failed-delivery details', () => {
    expect(readFileSync('src/components/settings/StatusView.tsx', 'utf8'))
      .toContain('<dl className=');
    expect(readFileSync('src/server/tools/system.ts', 'utf8'))
      .toContain('.api.accounts(accountSid).fetch()');
    expect(readFileSync('src/server/tools/system.ts', 'utf8'))
      .toContain('await transport.verify()');
    expect(readFileSync('src/app/settings/layout.tsx', 'utf8'))
      .toContain('reachable without TLS');
    expect(readFileSync('src/app/settings/layout.tsx', 'utf8'))
      .toContain("hostHeader.startsWith('[')");
    expect(readFileSync('src/app/notifications/page.tsx', 'utf8'))
      .toContain('Provider detail:');
  });
});
