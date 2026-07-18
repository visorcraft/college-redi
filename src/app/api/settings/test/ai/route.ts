import { NextResponse } from 'next/server';
import { callTool } from '@/server/tools/call';

export async function POST(req: Request) {
  const result = await callTool(
    'test_ai_connection',
    await req.json().catch(() => ({})),
    { actor: 'user' },
  );
  return NextResponse.json(result);
}
