import { NextResponse, type NextRequest } from 'next/server';
import { readSessionToken, SESSION_COOKIE } from '@/server/auth';
import { ensureBootstrapped } from '@/server/bootstrap';
import { getSecret } from '@/server/secrets';
import { getSettings } from '@/server/settings';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  await ensureBootstrapped();
  const { valid } = await readSessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  const passwordSet = (await getSecret('login.password_hash')) !== null;
  const settings = await getSettings();
  return NextResponse.json({
    authenticated: valid,
    passwordSet,
    wizardCompleted: settings.wizard_state.completed,
  });
}
