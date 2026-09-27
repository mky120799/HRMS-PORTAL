import { isIPv4, isIPv6 } from 'net';

/** Strips the IPv4-mapped IPv6 prefix Node reports for dual-stack sockets. */
export function normalizeIp(ip: string): string {
  return ip.startsWith('::ffff:') && isIPv4(ip.slice(7)) ? ip.slice(7) : ip;
}

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

/** Validates a whitelist entry: an IPv4/IPv6 address or an IPv4 CIDR range. */
export function isValidIpRule(rule: string): boolean {
  const [addr, bits, extra] = rule.trim().split('/');
  if (extra !== undefined) return false;
  if (bits === undefined) return isIPv4(addr) || isIPv6(addr);
  const n = Number(bits);
  return isIPv4(addr) && Number.isInteger(n) && n >= 0 && n <= 32;
}

/** True when `ip` equals a listed address or falls inside a listed IPv4 CIDR. */
export function ipMatchesAny(rawIp: string, rules: string[]): boolean {
  const ip = normalizeIp(rawIp);
  return rules.some((rule) => {
    const [addr, bits] = rule.trim().split('/');
    if (bits === undefined) return normalizeIp(addr) === ip;
    if (!isIPv4(ip) || !isIPv4(addr)) return false;
    const prefix = Number(bits);
    const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
    return (ipv4ToInt(ip) & mask) === (ipv4ToInt(addr) & mask);
  });
}
