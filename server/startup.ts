/**
 * The app couldn't start (no database binding, a failed migration, bad configuration). /api/*
 * callers get JSON like every other error; a browser navigating to /auth/* gets a sentence.
 */
export function startupFailure(request: Request, message: string): Response {
  const headers = { 'cache-control': 'no-store', 'retry-after': '30' };
  if (new URL(request.url).pathname.startsWith('/api/')) {
    return Response.json({ error: 'server_unavailable', message }, { status: 503, headers });
  }
  return new Response(message, { status: 503, headers: { ...headers, 'content-type': 'text/plain; charset=utf-8' } });
}
