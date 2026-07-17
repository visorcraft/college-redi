import { NextResponse } from 'next/server';
import { addSenderRuleParams } from '@/server/tools/email';
import { callTool } from '@/server/tools/call';
import { apiError } from '../../_utils';

export async function GET() {
  try {
    return NextResponse.json(await callTool('list_sender_rules', {}, { actor: 'user' }));
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const params = addSenderRuleParams.parse(await req.json().catch(() => ({})));
    return NextResponse.json(
      await callTool('add_sender_rule', params, { actor: 'user' }),
      { status: 201 },
    );
  } catch (error) {
    return apiError(error);
  }
}
