import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Minimal cookie helpers (the API only needs two cookies, so no plugin).
 *
 * - `hrms_refresh`: the refresh token. httpOnly so injected script cannot read
 *   it; SameSite=Strict so cross-site requests never carry it; scoped to the
 *   auth routes so ordinary API calls do not send it.
 * - `hrms_sso`: a random nonce bound into the signed SSO `state`, so an SSO
 *   callback is only accepted in the browser that started the flow (blocks
 *   login CSRF). SameSite=None because the SAML ACS callback is a cross-site
 *   POST; browsers treat http://localhost as secure, so `Secure` works in dev.
 */
export const REFRESH_COOKIE = 'hrms_refresh';
export const SSO_NONCE_COOKIE = 'hrms_sso';
const AUTH_COOKIE_PATH = '/api/v1/auth';

interface CookieOptions {
  maxAgeSeconds: number;
  sameSite: 'Strict' | 'Lax' | 'None';
  secure: boolean;
  path?: string;
}

function serialize(name: string, value: string, opts: CookieOptions) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${opts.path ?? AUTH_COOKIE_PATH}`,
    `Max-Age=${opts.maxAgeSeconds}`,
    'HttpOnly',
    `SameSite=${opts.sameSite}`,
  ];
  if (opts.secure) parts.push('Secure');
  return parts.join('; ');
}

function appendSetCookie(reply: FastifyReply, cookie: string) {
  const existing = reply.getHeader('set-cookie');
  const list = existing === undefined ? [] : Array.isArray(existing) ? existing.map(String) : [String(existing)];
  void reply.header('set-cookie', [...list, cookie]);
}

export function readCookie(request: FastifyRequest, name: string): string | undefined {
  const header = request.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) {
      try {
        return decodeURIComponent(part.slice(index + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

export function setRefreshCookie(reply: FastifyReply, token: string, maxAgeSeconds: number, secure: boolean) {
  appendSetCookie(reply, serialize(REFRESH_COOKIE, token, { maxAgeSeconds, sameSite: 'Strict', secure }));
}

export function clearRefreshCookie(reply: FastifyReply, secure: boolean) {
  appendSetCookie(reply, serialize(REFRESH_COOKIE, '', { maxAgeSeconds: 0, sameSite: 'Strict', secure }));
}

export function setSsoNonceCookie(reply: FastifyReply, nonce: string) {
  appendSetCookie(reply, serialize(SSO_NONCE_COOKIE, nonce, { maxAgeSeconds: 600, sameSite: 'None', secure: true }));
}

export function clearSsoNonceCookie(reply: FastifyReply) {
  appendSetCookie(reply, serialize(SSO_NONCE_COOKIE, '', { maxAgeSeconds: 0, sameSite: 'None', secure: true }));
}
