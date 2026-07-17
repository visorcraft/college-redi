export type ToolErrorCode =
  | 'bad_request' | 'not_found' | 'conflict' | 'confirm_required'
  | 'validation' | 'ai_not_configured' | 'import_failed' | 'internal';

export class ToolError extends Error {
  constructor(public readonly code: ToolErrorCode, message: string, public readonly httpStatus = 400) {
    super(message);
    this.name = 'ToolError';
  }
}
export class NotFoundError extends ToolError {
  constructor(message: string) { super('not_found', message, 404); this.name = 'NotFoundError'; }
}
export class ConflictError extends ToolError {
  constructor(message: string) { super('conflict', message, 409); this.name = 'ConflictError'; }
}
export class ConfirmRequiredError extends ToolError {
  constructor(toolName: string) {
    super('confirm_required', `${toolName} is destructive; pass confirm: true to proceed`, 400);
    this.name = 'ConfirmRequiredError';
  }
}

export function errorResponse(err: unknown): Response {
  if (err instanceof ToolError) {
    return Response.json({ error: { code: err.code, message: err.message } }, { status: err.httpStatus });
  }
  if (err && typeof err === 'object' && (err as { name?: string }).name === 'ZodError') {
    return Response.json({ error: { code: 'validation', message: (err as Error).message } }, { status: 400 });
  }
  if (err && typeof err === 'object' && (err as { name?: string }).name === 'ToolValidationError') {
    return Response.json({ error: { code: 'validation', message: (err as Error).message } }, { status: 400 });
  }
  if (err && typeof err === 'object' && (err as { name?: string }).name === 'ToolConfirmationRequiredError') {
    return Response.json({ error: { code: 'confirm_required', message: (err as Error).message } }, { status: 400 });
  }
  if (err && typeof err === 'object' && (err as { name?: string }).name === 'AiNotConfiguredError') {
    return Response.json({ error: { code: 'ai_not_configured', message: (err as Error).message } }, { status: 503 });
  }
  const message = err instanceof Error ? err.message : 'internal error';
  return Response.json({ error: { code: 'internal', message } }, { status: 500 });
}
