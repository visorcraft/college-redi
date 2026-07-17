import { NextResponse } from 'next/server';
import { callTool } from '@/server/tools/call';
import { reclassifyEmailParams } from '@/server/tools/email';
import { apiError } from '../../../../_utils';

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const params = reclassifyEmailParams.parse({
      ...(await req.json().catch(() => ({}))),
      id: (await context.params).id,
    });
    return NextResponse.json(await callTool(
      'reclassify_email',
      params,
      { actor: 'user' },
    ));
  } catch (error) {
    return apiError(error);
  }
}
