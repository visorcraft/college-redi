import { z } from 'zod';

export type SideEffect = 'read' | 'write' | 'destructive';

export interface ToolContext {
  actor: string;
}

export interface Tool<P = unknown, R = unknown> {
  name: string;
  description: string;
  sideEffect: SideEffect;
  paramsSchema: z.ZodType<P>;
  jsonSchema: Record<string, unknown>;
  handler(ctx: ToolContext, params: P): Promise<R>;
}

const globalState = globalThis as typeof globalThis & { __rediTools?: Map<string, Tool> };
const tools = globalState.__rediTools ??= new Map<string, Tool>();

export function defineTool<P, R>(spec: Omit<Tool<P, R>, 'jsonSchema'>): Tool<P, R> {
  return { ...spec, jsonSchema: z.toJSONSchema(spec.paramsSchema) as Record<string, unknown> };
}

export function registerTool(tool: Tool): void {
  if (tools.has(tool.name)) throw new Error(`duplicate tool registration: ${tool.name}`);
  tools.set(tool.name, tool);
}

export function getTool(name: string): Tool | undefined {
  return tools.get(name);
}

export function listTools(): Tool[] {
  return [...tools.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function _resetRegistryForTests(): void {
  tools.clear();
}
