import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SCRIPT = path.resolve(process.cwd(), 'scripts/bootstrap-env.sh');

function run(dataDir: string, extraEnv: Record<string, string> = {}) {
  return spawnSync('sh', [SCRIPT], {
    env: { PATH: process.env.PATH ?? '', NODE_ENV: process.env.NODE_ENV ?? 'test', DATA_DIR: dataDir, ...extraEnv },
    encoding: 'utf8',
  });
}

describe('scripts/bootstrap-env.sh (spec §4.6)', () => {
  it('generates credentials with mode 0600 when .env is absent, without logging values', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'redi-bootstrap-'));
    try {
      const result = run(dir);
      expect(result.status).toBe(0);
      expect(result.stdout + result.stderr).not.toMatch(/MONGRELDB_DB_PASSWORD=.{8}/);
      expect(result.stdout + result.stderr).not.toMatch(/MONGRELDB_PASSPHRASE=.{8}/);
      const content = readFileSync(path.join(dir, '.env'), 'utf8');
      expect(statSync(path.join(dir, '.env')).mode & 0o777).toBe(0o600);
      for (const key of ['MONGRELDB_DB_USERNAME=redi', 'MONGRELDB_DB_PASSWORD=', 'MONGRELDB_PASSPHRASE=', 'REDI_SETUP_TOKEN=', 'DATABASE_MODE=embedded', 'MONGRELDB_URL=']) {
        expect(content).toContain(key);
      }
      const password = /^MONGRELDB_DB_PASSWORD=(.+)$/m.exec(content)?.[1] ?? '';
      const passphrase = /^MONGRELDB_PASSPHRASE=(.+)$/m.exec(content)?.[1] ?? '';
      expect(password.length).toBeGreaterThanOrEqual(40);
      expect(passphrase.length).toBeGreaterThanOrEqual(40);
      expect(password).not.toBe(passphrase);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is idempotent: never overwrites an existing .env', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'redi-bootstrap-'));
    try {
      const sentinel = 'MONGRELDB_DB_USERNAME=custom\nMONGRELDB_DB_PASSWORD=keepme\n';
      writeFileSync(path.join(dir, '.env'), sentinel, { mode: 0o600 });
      chmodSync(path.join(dir, '.env'), 0o644);
      const result = run(dir);
      expect(result.status).toBe(0);
      expect(readFileSync(path.join(dir, '.env'), 'utf8')).toBe(sentinel);
      expect(statSync(path.join(dir, '.env')).mode & 0o777).toBe(0o600);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('honours a custom MONGRELDB_DB_USERNAME on first boot', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'redi-bootstrap-'));
    try {
      const result = run(dir, { MONGRELDB_DB_USERNAME: 'student1' });
      expect(result.status).toBe(0);
      expect(readFileSync(path.join(dir, '.env'), 'utf8')).toContain('MONGRELDB_DB_USERNAME=student1');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
