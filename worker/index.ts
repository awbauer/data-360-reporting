import { createApp, purgeExpired } from '../server/app';
import { createAuth } from '../server/auth';
import { loadConfig, type Config } from '../server/config';
import { migrateD1, type SqlDatabase } from '../server/db';
import { createStore } from '../server/store';
import { MIGRATIONS } from './migrations';

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  /** D1 binding (see d1_databases in wrangler.jsonc). Schema: migrations/. */
  DB: SqlDatabase;
  [key: string]: unknown;
}

let app: ReturnType<typeof createApp> | undefined;
let migrated: Promise<unknown> | undefined;

function configFrom(env: Env, origin?: string): Config {
  const vars: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) if (typeof v === 'string') vars[k] = v;
  // OAuth callbacks follow the hostname the Worker is reached on unless pinned explicitly.
  if (origin) vars.APP_BASE_URL ||= origin;
  // The mock adapter needs node:sqlite, which Workers don't have.
  vars.DATA360_MOCK = '';
  return loadConfig(vars);
}

/**
 * Cloudflare Worker entry. Static files are served by the assets binding before this runs;
 * only /api/* and /auth/* reach the Worker (see run_worker_first in wrangler.jsonc).
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!app) {
      if (!env.DB) return new Response('D1 binding "DB" is missing: see wrangler.jsonc', { status: 500 });
      // Once per isolate; a failure is retried on the next request rather than cached.
      try {
        await (migrated ??= migrateD1(env.DB, MIGRATIONS).then((ran) => ran.length && console.log(`Applied D1 migrations: ${ran.join(', ')}`)));
      } catch (e) {
        migrated = undefined;
        console.error(e);
        return new Response('Database migration failed; see the Worker logs.', { status: 500 });
      }
      const config = configFrom(env, new URL(request.url).origin);
      app = createApp({ config, auth: createAuth(config, env.DB), store: createStore(env.DB), fetch: (url, init) => fetch(url, init) });
    }
    return app.fetch(request, env);
  },

  /** Daily cron (triggers.crons in wrangler.jsonc): drop audit entries past AUDIT_RETENTION_DAYS. */
  async scheduled(_event: unknown, env: Env): Promise<void> {
    await migrateD1(env.DB, MIGRATIONS);
    const deleted = await purgeExpired(configFrom(env, 'https://cron.invalid'), createStore(env.DB));
    console.log(`Audit purge removed ${deleted} entries`);
  },
};
