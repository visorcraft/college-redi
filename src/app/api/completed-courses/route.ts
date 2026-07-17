import { callTool } from '../../../server/tools/call';
import { errorResponse } from '../../../server/tools/errors';
import { listCompletedCourses } from '../../../server/degree/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  try {
    const programId = new URL(req.url).searchParams.get('program_id');
    if (!programId) {
      return Response.json({ error: { code: 'validation', message: 'program_id query param is required' } }, { status: 400 });
    }
    return Response.json(await listCompletedCourses(programId));
  } catch (err) { return errorResponse(err); }
}

export async function POST(req: Request): Promise<Response> {
  try {
    return Response.json(await callTool('mark_course_completed', await req.json(), { actor: 'user' }), { status: 201 });
  } catch (err) { return errorResponse(err); }
}
