import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 60_000,
  globalSetup: './tests/e2e/global-setup.ts',
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:3100',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /0[1-5]-.*\.spec\.ts$/,
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'] },
      testMatch: /mobile\.spec\.ts$/,
    },
  ],
  webServer: [
    {
      command: 'node tests/e2e/stub-ai-server.mjs',
      url: 'http://127.0.0.1:3999/v1/health',
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command:
        'rm -rf tests/e2e/.runtime-data && npm run build && npm run start -- -p 3100',
      url: 'http://127.0.0.1:3100/api/health',
      reuseExistingServer: false,
      timeout: 300_000,
      env: {
        PORT: '3100',
        DATA_DIR: './tests/e2e/.runtime-data',
        ALLOW_PRIVATE_NETWORK_TARGETS: 'true',
        DATABASE_MODE: 'embedded',
        SCHEDULER_ENABLED: 'false',
        CRON_SECRET: 'e2e-cron-secret',
        REDI_MASTER_KEY: 'c'.repeat(64),
        SESSION_SECRET: 'e2e-session-secret',
        REDI_SETUP_TOKEN: 'e2e-setup-token-0123456789abcdef0123456789abcdef',
        MONGRELDB_DB_USERNAME: 'redi',
        MONGRELDB_DB_PASSWORD: 'e2e-db-password',
        MONGRELDB_PASSPHRASE: 'e2e-db-passphrase',
      },
    },
  ],
});
