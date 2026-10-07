import { afterEach, describe, expect, it, vi } from 'vitest';
import { startupFailure } from '../server/startup';
import { ApiError, NETWORK_ERROR, api } from '../web/api';

const respond = (body: string, init: ResponseInit = {}) => vi.fn(async () => new Response(body, init));
async function failure(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p;
  } catch (e) {
    return e as ApiError;
  }
  throw new Error('expected the request to fail');
}

describe('the client reads every kind of failure', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses the message from a JSON error', async () => {
    vi.stubGlobal('fetch', respond(JSON.stringify({ error: 'not_found', message: 'That plan no longer exists.' }), { status: 404 }));
    const e = await failure(api.plans.get('x'));
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toMatchObject({ status: 404, code: 'not_found', message: 'That plan no longer exists.' });
  });

  it('shows a short plain-text error as it is, instead of a JSON parse error', async () => {
    vi.stubGlobal('fetch', respond('Database migration failed; see the Worker logs.', { status: 500 }));
    const e = await failure(api.session());
    expect(e).toMatchObject({ status: 500, code: 'error', message: 'Database migration failed; see the Worker logs.' });
  });

  it('does not show an HTML error page, only what the status means', async () => {
    vi.stubGlobal('fetch', respond('<!doctype html><title>Error 1101</title><h1>Worker threw exception</h1>', { status: 500 }));
    expect((await failure(api.session())).message).toBe('The server ran into a problem (HTTP 500). Try again shortly.');
    vi.stubGlobal('fetch', respond('', { status: 403 }));
    expect((await failure(api.session())).message).toBe('Request failed (HTTP 403).');
  });

  it('says so when a successful response is not JSON', async () => {
    vi.stubGlobal('fetch', respond('<!doctype html><div id="root"></div>', { status: 200 }));
    expect(await failure(api.session())).toMatchObject({ status: 200, code: 'bad_response' });
  });

  it('reports a network failure as one, not as a server error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    expect(await failure(api.session())).toMatchObject({ status: NETWORK_ERROR, code: 'network', message: expect.stringMatching(/Could not reach the server/) });
  });

  it('still returns empty and JSON bodies', async () => {
    vi.stubGlobal('fetch', respond('', { status: 200 }));
    expect(await api.session()).toBeNull();
    vi.stubGlobal('fetch', respond('{"ok":true}', { status: 200 }));
    expect(await api.session()).toEqual({ ok: true });
  });
});

describe('a Worker that cannot start', () => {
  it('answers /api/* with a JSON error the client can show', async () => {
    const res = startupFailure(new Request('https://x.dev/api/session'), 'The server could not update its database.');
    expect(res.status).toBe(503);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    expect(await res.json()).toEqual({ error: 'server_unavailable', message: 'The server could not update its database.' });
  });

  it('answers a browser navigation to /auth/* with a sentence', async () => {
    const res = startupFailure(new Request('https://x.dev/auth/callback?code=1'), 'The server could not update its database.');
    expect(res.status).toBe(503);
    expect(res.headers.get('content-type')).toMatch(/text\/plain/);
    expect(await res.text()).toBe('The server could not update its database.');
  });
});
