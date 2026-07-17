import { callTool } from '../../../../../server/tools/call';
import { errorResponse } from '../../../../../server/tools/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  try {
    return Response.json(await callTool('confirm_degree_import', await req.json(), { actor: 'user' }));
  } catch (err) {
    return errorResponse(err);
  }
}
