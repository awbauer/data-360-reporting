// AES-256-GCM sealing of small JSON payloads (session cookies). WebCrypto only.

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

async function importKey(secret: string): Promise<CryptoKey> {
  const raw = await crypto.subtle.digest('SHA-256', enc.encode(secret));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function seal(secret: string, payload: unknown, ttlSeconds: number, now = Date.now()): Promise<string> {
  const key = await importKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const body = enc.encode(JSON.stringify({ exp: Math.floor(now / 1000) + ttlSeconds, d: payload }));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, body));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return b64url(out);
}

/** Returns null for anything tampered, malformed, wrongly keyed or expired. */
export async function unseal<T>(secret: string, token: string, now = Date.now()): Promise<T | null> {
  try {
    const bytes = new Uint8Array(Buffer.from(token, 'base64url'));
    if (bytes.length < 13 + 16) return null;
    const key = await importKey(secret);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, key, bytes.slice(12));
    const { exp, d } = JSON.parse(dec.decode(pt)) as { exp: number; d: T };
    return exp * 1000 > now ? d : null;
  } catch {
    return null;
  }
}

export function randomToken(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function pkceChallenge(verifier: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(verifier))));
}
