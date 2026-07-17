import { callTool } from '../../../server/tools/call';
import { errorResponse } from '../../../server/tools/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  try {
    return Response.json(await callTool('list_terms', {}, { actor: 'user' }));
  } catch (err) { return errorResponse(err); }
}

export async function POST(req: Request): Promise<Response> {
  try {
    return Response.json(await callTool('upsert_term', await req.json(), { actor: 'user' }), { status: 201 });
  } catch (err) { return errorResponse(err); }
}
