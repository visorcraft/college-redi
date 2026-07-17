import { callTool } from '../../../server/tools/call';
import { errorResponse } from '../../../server/tools/errors';
import { listPlannedCourses } from '../../../server/degree/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  try {
    const sp = new URL(req.url).searchParams;
    const termId = sp.get('term_id');
    const programId = sp.get('program_id');
    if (termId) {
      return Response.json(await callTool('get_registration_status', { term_id: termId }, { actor: 'user' }));
    }
    if (!programId) {
      return Response.json({ error: { code: 'validation', message: 'program_id (or term_id) query param is required' } }, { status: 400 });
    }
    return Response.json(await listPlannedCourses(programId));
  } catch (err) { return errorResponse(err); }
}

export async function POST(req: Request): Promise<Response> {
  try {
    return Response.json(await callTool('plan_course', await req.json(), { actor: 'user' }), { status: 201 });
  } catch (err) { return errorResponse(err); }
}
