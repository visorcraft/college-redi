import { randomUUID } from 'node:crypto';
import { lit, sqlExec } from '../db/sql';
import { getTool, type ToolContext } from './registry';

export class ToolNotFoundError extends Error {
  constructor(toolName: string) {
    super(`unknown tool: ${toolName}`);
    this.name = 'ToolNotFoundError';
  }
}

export class ToolValidationError extends Error {
  constructor(toolName: string, message: string) {
    super(`invalid params for ${toolName}: ${message}`);
    this.name = 'ToolValidationError';
  }
}

export class ToolConfirmationRequiredError extends Error {
  constructor(toolName: string) {
    super(`${toolName} is destructive and requires params.confirm === true`);
    this.name = 'ToolConfirmationRequiredError';
  }
}

async function writeAudit(actor: string, toolName: string, detail: Record<string, unknown>): Promise<void> {
  try {
    await sqlExec(
      `INSERT INTO audit_log (` +
      `id, actor, tool_name, entity_type, entity_id, detail, created_at` +
      `) VALUES (` +
      `${lit(randomUUID())}, ${lit(actor)}, ${lit(toolName)}, NULL, NULL, ` +
      `${lit(JSON.stringify(detail))}, ${lit(new Date())})`,
    );
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', msg: 'audit_log write failed', error: String(err) }));
  }
}

export async function callTool(name: string, params: unknown, ctx: ToolContext): Promise<unknown> {
  const tool = getTool(name);
  if (!tool) throw new ToolNotFoundError(name);
  const started = Date.now();
  try {
    const parsed = tool.paramsSchema.safeParse(params ?? {});
    if (!parsed.success) {
      throw new ToolValidationError(name, parsed.error.issues.map((i) => i.message).join('; '));
    }
    if (tool.sideEffect === 'destructive' && (parsed.data as Record<string, unknown>).confirm !== true) {
      throw new ToolConfirmationRequiredError(name);
    }
    const result = await tool.handler(ctx, parsed.data);
    await writeAudit(ctx.actor, name, { ok: true, duration_ms: Date.now() - started });
    return result;
  } catch (err) {
    await writeAudit(ctx.actor, name, {
      ok: false,
      duration_ms: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
