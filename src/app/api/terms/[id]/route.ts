import { callTool } from '../../../../server/tools/call';
import { errorResponse } from '../../../../server/tools/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx): Promise<Response> {
  try {
    return Response.json(await callTool('upsert_term', { id: (await params).id, ...(await req.json()) }, { actor: 'user' }));
  } catch (err) { return errorResponse(err); }
}

export async function DELETE(req: Request, { params }: Ctx): Promise<Response> {
  try {
    const body = await req.json().catch(() => ({}));
    return Response.json(await callTool('delete_term', { id: (await params).id, confirm: body.confirm === true }, { actor: 'user' }));
  } catch (err) { return errorResponse(err); }
}
