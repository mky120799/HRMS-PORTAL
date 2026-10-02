import { lookup } from 'dns/promises';
import { isIP } from 'net';

/**
 * Guards server-side requests to URLs that tenant admins configure (OIDC
 * issuer, token and JWKS endpoints). Without it an admin could point the
 * "issuer" at http://169.254.169.254/ or an internal service and make our
 * servers call it (SSRF).
 *
 * The hostname is resolved and every address must be public. Redirects are
 * refused so a public URL cannot bounce to a private one. A DNS-rebinding race
 * between this check and the request remains possible; the egress firewall is
 * the backstop for that.
 */
export interface OutboundPolicy {
  /** Development/test only: allow localhost and private ranges (e.g. a local Keycloak). */
  allowPrivate: boolean;
  /** Production: refuse plain http. */
  requireHttps: boolean;
}

export class OutboundUrlError extends Error {}

export function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isPrivateIpv4(address);
  if (version === 6) {
    const lower = address.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped) return isPrivateIpv4(mapped[1]);
    return (
      lower === '::' ||
      lower === '::1' ||
      lower.startsWith('fc') ||
      lower.startsWith('fd') || // unique local fc00::/7
      /^fe[89ab]/.test(lower) || // link-local fe80::/10
      lower.startsWith('ff') // multicast
    );
  }
  return true; // not an IP at all: treat as unsafe
}

function isPrivateIpv4(address: string): boolean {
  const [a, b] = address.split('.').map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    a >= 224 // multicast and reserved
  );
}

export async function assertOutboundUrl(raw: string, policy: OutboundPolicy): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new OutboundUrlError('Invalid URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new OutboundUrlError('Only http(s) URLs are allowed');
  if (policy.requireHttps && url.protocol !== 'https:') throw new OutboundUrlError('URL must use https');
  if (url.username || url.password) throw new OutboundUrlError('URL must not contain credentials');
  if (policy.allowPrivate) return url;

  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true, verbatim: true })).map((entry) => entry.address);
  if (!addresses.length || addresses.some(isPrivateAddress)) {
    throw new OutboundUrlError('URL resolves to a private or reserved network address');
  }
  return url;
}

/** fetch() for admin-configured URLs: validated target, no redirects, bounded time. */
export async function outboundFetch(raw: string, init: RequestInit, policy: OutboundPolicy): Promise<Response> {
  const url = await assertOutboundUrl(raw, policy);
  return fetch(url, { ...init, redirect: 'error', signal: init.signal ?? AbortSignal.timeout(10_000) });
}
