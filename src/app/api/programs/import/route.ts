import { callTool } from '../../../../server/tools/call';
import { errorResponse } from '../../../../server/tools/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_MULTIPART_BYTES = MAX_UPLOAD_BYTES + 64 * 1024;
const ALLOWED_UPLOAD_TYPES = new Set(['', 'application/octet-stream', 'application/pdf', 'text/plain']);

export async function POST(req: Request): Promise<Response> {
  try {
    const contentType = req.headers.get('content-type') ?? '';
    let params: Record<string, unknown>;
    if (contentType.includes('multipart/form-data')) {
      const contentLength = Number(req.headers.get('content-length'));
      if (Number.isFinite(contentLength) && contentLength > MAX_MULTIPART_BYTES) {
        return Response.json(
          { error: { code: 'validation', message: 'audit file must be 10 MB or smaller' } },
          { status: 413 },
        );
      }
      const form = await req.formData();
      const file = form.get('file');
      if (!(file instanceof File)) {
        return Response.json(
          { error: { code: 'validation', message: 'multipart field "file" is required' } },
          { status: 400 },
        );
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        return Response.json(
          { error: { code: 'validation', message: 'audit file must be 10 MB or smaller' } },
          { status: 413 },
        );
      }
      if (!/\.(pdf|txt)$/i.test(file.name) || !ALLOWED_UPLOAD_TYPES.has(file.type)) {
        return Response.json(
          { error: { code: 'validation', message: 'audit file must be a PDF or plain-text file' } },
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
