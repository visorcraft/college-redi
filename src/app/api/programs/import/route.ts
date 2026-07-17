import { callTool } from '../../../../server/tools/call';
import { errorResponse } from '../../../../server/tools/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  try {
    const contentType = req.headers.get('content-type') ?? '';
    let params: Record<string, unknown>;
    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData();
      const file = form.get('file');
      if (!(file instanceof File)) {
        return Response.json(
          { error: { code: 'validation', message: 'multipart field "file" is required' } },
          { status: 400 },
        );
      }
      const buf = Buffer.from(await file.arrayBuffer());
      params = { file_base64: buf.toString('base64'), filename: file.name };
    } else {
      params = await req.json();
    }
    return Response.json(await callTool('import_degree_audit', params, { actor: 'user' }));
  } catch (err) {
    return errorResponse(err);
  }
}
