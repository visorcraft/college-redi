import { schema } from '../../db/schema';
import { sqlExec, sqlRows, withSqlTransaction } from './db/sql';

const EXPORT_TABLES = schema.tablesList()
  .map((table) => table.name)
  .filter((name) => name !== 'secrets' && name !== 'mcp_tokens');

export async function exportUserData(): Promise<Record<string, unknown>> {
  const entries = await Promise.all(
    EXPORT_TABLES.map(async (name) => [name, await sqlRows(`SELECT * FROM "${name}"`)] as const),
  );
  const tokenMetadata = await sqlRows(
    'SELECT id, name, created_at, last_used_at, revoked_at FROM mcp_tokens',
  );
  return {
    exported_at: new Date().toISOString(),
    format_version: 1,
    data: Object.fromEntries([...entries, ['mcp_tokens', tokenMetadata]]),
  };
}

export async function deleteAllUserData(): Promise<void> {
  await withSqlTransaction(async () => {
    for (const table of [...schema.tablesList()].reverse()) {
      await sqlExec(`DELETE FROM "${table.name}"`);
    }
  });
}
