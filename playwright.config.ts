import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';

const PORT = 4173;
const LIVE_PORT = 4174; // same app, not in mock mode: exercises the real Connect screen
// Use a preinstalled Chromium when present (cloud sandboxes); otherwise Playwright's own.
const preinstalled = '/opt/pw-browsers/chromium';
const executablePath = process.env.PW_CHROMIUM_PATH ?? (existsSync(preinstalled) ? preinstalled : undefined);

// The live server's SQLite file, shared with e2e/live-session.ts so tests can sign a user in.
// The config is loaded again in each worker; only the first load (the runner) starts fresh.
export const LIVE_SESSION_KEY = 'e2e-session-key-'.repeat(3);
if (!process.env.D360_E2E_DB) {
  process.env.D360_E2E_DB = join(tmpdir(), 'd360-e2e-live.db');
  for (const f of ['', '-wal', '-shm']) rmSync(process.env.D360_E2E_DB + f, { force: true });
}

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  timeout: 60_000,
  use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure', launchOptions: { executablePath } },
  webServer: [
    {
      command: `DATA360_MOCK=1 PORT=${PORT} APP_BASE_URL=http://localhost:${PORT} DATABASE_PATH=:memory: AUTH_ADMIN_EMAILS=demo@example.com tsx server/entry-node.ts`,
      url: `http://localhost:${PORT}/api/session`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `PORT=${LIVE_PORT} APP_BASE_URL=http://localhost:${LIVE_PORT} SESSION_KEY=${LIVE_SESSION_KEY} DATABASE_PATH=${process.env.D360_E2E_DB} AUTH_ALLOWED_DOMAINS=example.com SF_AUTHORIZE_PREFLIGHT=0 tsx server/entry-node.ts`,
      url: `http://localhost:${LIVE_PORT}/api/session`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
