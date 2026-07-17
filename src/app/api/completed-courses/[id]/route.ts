import { callTool } from '../../../../server/tools/call';
import { errorResponse } from '../../../../server/tools/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    return Response.json(await callTool('unmark_course_completed', { id: (await params).id }, { actor: 'user' }));
  } catch (err) { return errorResponse(err); }
}
