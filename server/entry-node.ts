import { existsSync } from 'node:fs';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createApp } from './app';
import { loadConfig } from './config';

const config = loadConfig();
// Loaded lazily so production never touches the experimental node:sqlite module.
const mockClient = config.mock ? (await import('./data360/mock/client')).createMockClient() : undefined;
const app = createApp({ config, ...(mockClient ? { mockClient } : {}) });

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
