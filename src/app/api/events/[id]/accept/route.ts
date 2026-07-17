import { NextResponse } from 'next/server';
import { acceptEventParams } from '@/server/tools/email';
import { callTool } from '@/server/tools/call';
import { apiError } from '../../../_utils';

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const params = acceptEventParams.parse({
      ...(await req.json().catch(() => ({}))),
      id: (await context.params).id,
    });
    return NextResponse.json(await callTool('accept_event', params, { actor: 'user' }));
  } catch (error) {
    return apiError(error);
  }
}
