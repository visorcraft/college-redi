import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export interface RunningServer {
  baseUrl: string;
  dataDir: string;
  stop(): Promise<void>;
}

export async function startTestServer(): Promise<RunningServer> {
  const port = 3200 + Math.floor(Math.random() * 400);
  const dataDir = mkdtempSync(path.join(tmpdir(), 'redi-it-'));
  const child: ChildProcess = spawn('npx', ['next', 'dev', '--port', String(port)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATA_DIR: dataDir,
      DATABASE_MODE: 'embedded',
      MONGRELDB_DB_USERNAME: 'redi',
      MONGRELDB_DB_PASSWORD: 'it-db-password-0123456789abcdef',
      MONGRELDB_PASSPHRASE: 'it-passphrase-0123456789abcdef',
      SESSION_SECRET: 'it-session-secret',
      SCHEDULER_ENABLED: 'false',
      NEXT_TELEMETRY_DISABLED: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 150_000;
  for (;;) {
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) break;
    } catch {
      // server not up yet
    }
    if (Date.now() > deadline) {
      child.kill('SIGKILL');
      throw new Error(`test server did not become healthy on ${baseUrl}`);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return {
    baseUrl,
    dataDir,
    async stop() {
      child.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
          resolve();
        }, 5000);
        child.on('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}
