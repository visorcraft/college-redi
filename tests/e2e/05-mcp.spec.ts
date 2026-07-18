import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('agent token connects a real MCP client', async ({ page }) => {
  await login(page);
  await page.goto('/settings/agent');
  await expect(page.getByRole('heading', { name: /ai agent access/i }))
    .toBeVisible();
  await page.getByLabel(/token name/i).fill('e2e-claude');
  await page.getByRole('button', { name: /create token/i }).click();
  const tokenElement = page.getByTestId('mcp-token-value');
  await expect(tokenElement).toBeVisible();
  const token = (await tokenElement.textContent())!.trim();
  expect(token).toMatch(/^redi_/);
  await expect(page.getByText(/mcp-remote/).first()).toBeVisible();

  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } = await import(
    '@modelcontextprotocol/sdk/client/streamableHttp.js'
  );
  const client = new Client({ name: 'e2e-mcp-smoke', version: '0.1.0' });
  await client.connect(new StreamableHTTPClientTransport(
    new URL('http://127.0.0.1:3100/mcp'),
    { requestInit: { headers: { Authorization: `Bearer ${token}` } } },
  ));
  const { tools } = await client.listTools();
  expect(tools.length).toBeGreaterThan(10);
  const call = await client.callTool({
    name: 'get_system_status',
    arguments: {},
  });
  expect(call.isError).toBeFalsy();
  await client.close();

  const unauthorized = await page.context().request.post('/mcp', {
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    data: {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {},
    },
  });
  expect(unauthorized.status()).toBe(401);

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
});
