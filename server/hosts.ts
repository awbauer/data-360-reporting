/**
 * The server makes outbound requests to hosts that originate from user input
 * (My Domain) and from OAuth responses (instance_url). Only allow https hosts
 * under configured Salesforce suffixes so a public deployment can't be used to
 * reach arbitrary or internal addresses.
 */
export class HostNotAllowedError extends Error {}

export function assertAllowedOrigin(input: string, suffixes: string[]): string {
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
  } catch {
    throw new HostNotAllowedError(`Not a valid host: ${input}`);
  }
  const host = url.hostname.toLowerCase();
  const ok = suffixes.some((s) => {
    const suffix = s.startsWith('.') ? s : `.${s}`;
    return host.endsWith(suffix) && host.length > suffix.length;
  });
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !ok) {
    throw new HostNotAllowedError(`Host not allowed: ${host}`);
  }
  return `https://${host}`;
}
