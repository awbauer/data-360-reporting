import { describe, expect, it } from 'vitest';
import { pkceChallenge, seal, unseal } from '../server/crypto';
import { assertAllowedOrigin, HostNotAllowedError } from '../server/hosts';

const KEY = 'k'.repeat(32);

describe('seal/unseal', () => {
  it('round-trips', async () => {
    const t = await seal(KEY, { a: 1 }, 60);
    expect(await unseal(KEY, t)).toEqual({ a: 1 });
  });
  it('rejects tampering, wrong key and expiry', async () => {
    const t = await seal(KEY, { a: 1 }, 60);
    const flipped = t.slice(0, -2) + (t.endsWith('AA') ? 'BB' : 'AA');
    expect(await unseal(KEY, flipped)).toBeNull();
    expect(await unseal('x'.repeat(32), t)).toBeNull();
    expect(await unseal(KEY, t, Date.now() + 61_000)).toBeNull();
    expect(await unseal(KEY, 'garbage')).toBeNull();
  });
  it('computes the RFC 7636 S256 example challenge', async () => {
    expect(await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });
});

describe('assertAllowedOrigin', () => {
  const sfx = ['.salesforce.com', '.force.com'];
  it.each([
    ['login.salesforce.com', 'https://login.salesforce.com'],
    ['https://acme.my.salesforce.com/path?x=1', 'https://acme.my.salesforce.com'],
    ['ACME.sandbox.my.salesforce.com', 'https://acme.sandbox.my.salesforce.com'],
    ['https://acme.my.site.force.com', 'https://acme.my.site.force.com'],
  ])('allows %s', (input, out) => expect(assertAllowedOrigin(input, sfx)).toBe(out));

  it.each([
    'http://acme.my.salesforce.com',
    'https://salesforce.com.evil.com',
    'https://evilsalesforce.com',
    'https://salesforce.com',
    'https://acme.my.salesforce.com:8443',
    'https://user:pw@acme.my.salesforce.com',
    'https://169.254.169.254',
    'localhost',
    '',
  ])('rejects %s', (input) => expect(() => assertAllowedOrigin(input, sfx)).toThrow(HostNotAllowedError));
});
