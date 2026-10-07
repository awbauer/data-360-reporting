import { existsSync } from 'node:fs';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createApp, purgeExpired } from './app';
import { createAuth } from './auth';
import { loadConfig } from './config';
import { openNodeDatabase } from './node-db';
import { createStore } from './store';

const config = loadConfig();
// SQLite file in place of D1. node:sqlite is still flagged experimental in Node 22 and logs a warning.
const { raw, db } = openNodeDatabase(config.databasePath);
const store = createStore(db);
// Loaded lazily so the mock's fixtures aren't loaded outside mock mode.
const mockClient = config.mock ? (await import('./data360/mock/client')).createMockClient() : undefined;
const app = createApp({ config, auth: createAuth(config, raw), store, ...(mockClient ? { mockClient } : {}) });

const purge = () => purgeExpired(config, store).catch((e: unknown) => console.error('Audit purge failed', e));
void purge();
setInterval(purge, 24 * 60 * 60 * 1000).unref();

const WEB_ROOT = './dist/web';
if (existsSync(WEB_ROOT)) {
  const assets = serveStatic({ root: WEB_ROOT });
  const index = serveStatic({ path: `${WEB_ROOT}/index.html` });
  const isBackend = (p: string) => p.startsWith('/api/') || p.startsWith('/auth/');
  app.get('*', (c, next) => (isBackend(c.req.path) ? next() : assets(c, next)));
  app.get('*', (c, next) => (isBackend(c.req.path) ? next() : index(c, next)));
} else {
  console.warn(`No ${WEB_ROOT} found; run "npm run build" or use "npm run dev" for the UI.`);
}

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`Data 360 Workbench listening on http://localhost:${info.port}${config.mock ? ' (MOCK MODE)' : ''}`);
});
