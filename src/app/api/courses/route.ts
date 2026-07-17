import { callTool } from '../../../server/tools/call';
import { errorResponse } from '../../../server/tools/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  try {
    const sp = new URL(req.url).searchParams;
    return Response.json(await callTool('list_courses', {
      program_id: sp.get('program_id'),
      subject: sp.get('subject') ?? undefined,
    }, { actor: 'user' }));
  } catch (err) { return errorResponse(err); }
}

export async function POST(req: Request): Promise<Response> {
  try {
    return Response.json(await callTool('add_course', await req.json(), { actor: 'user' }), { status: 201 });
  } catch (err) { return errorResponse(err); }
}
