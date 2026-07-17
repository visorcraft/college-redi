import { NextResponse } from 'next/server';
import { callTool } from '@/server/tools/call';

const CHANNELS = ['in_app', 'email', 'sms'] as const;
type Channel = (typeof CHANNELS)[number];

export async function POST(_req: Request, { params }: { params: Promise<{ channel: string }> }) {
  const { channel } = await params;
  if (!CHANNELS.includes(channel as Channel)) {
    return NextResponse.json(
      { error: { code: 'bad_channel', message: 'Channel must be one of: in_app, email, sms.' } },
      { status: 400 },
    );
  }
  const result = await callTool('send_test_notification', { channel }, { actor: 'user' });
  return NextResponse.json(result);
}
