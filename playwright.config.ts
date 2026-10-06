import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

const PORT = 4173;
const LIVE_PORT = 4174; // same app, not in mock mode: exercises the real Connect screen
// Use a preinstalled Chromium when present (cloud sandboxes); otherwise Playwright's own.
const preinstalled = '/opt/pw-browsers/chromium';
const executablePath = process.env.PW_CHROMIUM_PATH ?? (existsSync(preinstalled) ? preinstalled : undefined);

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  timeout: 60_000,
  use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure', launchOptions: { executablePath } },
  webServer: [
    {
      command: `DATA360_MOCK=1 PORT=${PORT} APP_BASE_URL=http://localhost:${PORT} tsx server/entry-node.ts`,
      url: `http://localhost:${PORT}/api/session`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `PORT=${LIVE_PORT} APP_BASE_URL=http://localhost:${LIVE_PORT} SESSION_KEY=${'e2e-session-key-'.repeat(3)} tsx server/entry-node.ts`,
      url: `http://localhost:${LIVE_PORT}/api/session`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
