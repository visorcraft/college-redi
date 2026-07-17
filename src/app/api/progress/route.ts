import { callTool } from '../../../server/tools/call';
import { errorResponse } from '../../../server/tools/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  try {
    const program_id = new URL(req.url).searchParams.get('program_id') ?? undefined;
    return Response.json(await callTool('get_degree_progress', { program_id }, { actor: 'user' }));
  } catch (err) { return errorResponse(err); }
}
