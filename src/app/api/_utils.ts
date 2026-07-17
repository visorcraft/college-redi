import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { ToolError, errorResponse } from '../../server/tools/errors';

export function apiError(error: unknown): NextResponse {
  if (error instanceof ZodError) {
    return NextResponse.json(
      { error: { code: 'validation_error', message: error.issues[0]?.message ?? 'invalid input' } },
      { status: 400 },
    );
  }
  if (error instanceof ToolError) {
    return errorResponse(error) as NextResponse;
  }
  return errorResponse(error) as NextResponse;
}
