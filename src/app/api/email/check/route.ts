import { NextResponse } from 'next/server';
import { callTool } from '@/server/tools/call';
import { apiError } from '../../_utils';

export async function POST() {
  try {
    return NextResponse.json(await callTool('check_email_now', {}, { actor: 'user' }));
  } catch (error) {
    return apiError(error);
  }
}
