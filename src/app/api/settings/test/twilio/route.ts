import { NextResponse } from 'next/server';
import { callTool } from '@/server/tools/call';

export async function POST() {
  const result = await callTool('test_twilio_connection', {}, { actor: 'user' });
  return NextResponse.json(result);
}
