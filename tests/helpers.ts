import { loadConfig, type Config } from '../server/config';
import { createApp } from '../server/app';
import { createMockClient } from '../server/data360/mock/client';
import type { FetchLike } from '../server/oauth';

export const SESSION_KEY = 's'.repeat(40);

export function testConfig(over: Record<string, string> = {}): Config {
  return loadConfig({
    SESSION_KEY,
    SF_CLIENT_ID: 'CLIENTID1234567890',
    SF_CLIENT_SECRET: 'sekret',
    APP_BASE_URL: 'https://wb.example.com',
    ...over,
  });
}

/** Collect Set-Cookie headers into a Cookie request header value. */
export function cookieJar() {
  const jar = new Map<string, string>();
  return {
    absorb(res: Response) {
      for (const line of res.headers.getSetCookie()) {
        const [pair] = line.split(';');
        const eq = pair!.indexOf('=');
        const name = pair!.slice(0, eq);
        const value = pair!.slice(eq + 1);
        if (!value || /max-age=0/i.test(line)) jar.delete(name);
        else jar.set(name, value);
      }
    },
    header: () => [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
    has: (name: string) => jar.has(name),
  };
}

export function mockApp() {
  const config = testConfig({ DATA360_MOCK: '1' });
  return createApp({ config, mockClient: createMockClient() });
}

export function realApp(fetchFn: FetchLike, over: Record<string, string> = {}) {
  return createApp({ config: testConfig(over), fetch: fetchFn });
}

export const H = { 'x-d360': '1', 'content-type': 'application/json' };
