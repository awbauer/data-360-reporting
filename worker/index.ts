import { createApp } from '../server/app';
import { loadConfig } from '../server/config';

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  [key: string]: unknown;
}

let app: ReturnType<typeof createApp> | undefined;

/**
 * Cloudflare Worker entry. Static files are served by the assets binding before this runs;
 * only /api/* and /auth/* reach the Worker (see run_worker_first in wrangler.jsonc).
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!app) {
      const vars: Record<string, string | undefined> = {};
      for (const [k, v] of Object.entries(env)) if (typeof v === 'string') vars[k] = v;
      // OAuth callbacks follow the hostname the Worker is reached on unless pinned explicitly.
      vars.APP_BASE_URL ||= new URL(request.url).origin;
      // The mock adapter needs node:sqlite, which Workers don't have.
      vars.DATA360_MOCK = '';
      app = createApp({ config: loadConfig(vars), fetch: (url, init) => fetch(url, init) });
    }
    return app.fetch(request, env);
  },
};
