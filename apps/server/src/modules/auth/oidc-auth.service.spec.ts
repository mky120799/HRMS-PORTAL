import { createSign, generateKeyPairSync, type KeyObject } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { assertBrowserBinding, browserBinding, OidcAuthService, type OidcDiscovery } from './oidc-auth.service';

const discovery: OidcDiscovery = {
  issuer: 'https://idp.example.com',
  authorization_endpoint: 'https://idp.example.com/authorize',
  token_endpoint: 'https://idp.example.com/token',
  jwks_uri: 'https://idp.example.com/jwks',
};
const CLIENT_ID = 'hrms-client';
const NONCE = 'nonce-123';

function keyPair(kid: string) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { kid, privateKey, jwk: { ...publicKey.export({ format: 'jwk' }), kid, use: 'sig', alg: 'RS256' } };
}

function sign(privateKey: KeyObject, header: Record<string, unknown>, claims: Record<string, unknown>) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const input = `${encode(header)}.${encode(claims)}`;
  const signature = createSign('RSA-SHA256').update(input).sign(privateKey).toString('base64url');
  return `${input}.${signature}`;
}

describe('OidcAuthService.verifyIdToken', () => {
  const current = keyPair('k1');
  const rotated = keyPair('k2');
  let published: object[];
  const fetchMock = jest.fn();
  const originalFetch = global.fetch;
  const service = new OidcAuthService(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    // allowPrivate is irrelevant here: the mocked fetch is never reached for private IPs
    new ConfigService({ ALLOW_PRIVATE_IDP_URLS: true, NODE_ENV: 'test' }),
  );

  const now = Math.floor(Date.now() / 1000);
  const claims = (extra: Record<string, unknown> = {}) => ({
    iss: discovery.issuer,
    aud: CLIENT_ID,
    exp: now + 300,
    iat: now,
    nonce: NONCE,
    email: 'ada@corp.com',
    email_verified: true,
    ...extra,
  });
  const verify = (token: string, allowMissingEmailVerified = false) =>
    service.verifyIdToken(discovery, CLIENT_ID, token, NONCE, { allowMissingEmailVerified });

  beforeAll(() => {
    global.fetch = fetchMock as any;
  });
  afterAll(() => {
    global.fetch = originalFetch;
  });
  beforeEach(() => {
    published = [current.jwk];
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => ({ ok: true, json: async () => ({ keys: published }) }));
    (service as any).jwksCache.clear();
  });

  it('accepts a correctly signed token with matching issuer, audience and nonce', async () => {
    await expect(verify(sign(current.privateKey, { alg: 'RS256', kid: 'k1' }, claims()))).resolves.toMatchObject({ email: 'ada@corp.com' });
  });

  it('rejects a bad signature, wrong issuer, wrong audience, wrong nonce and expired tokens', async () => {
    const header = { alg: 'RS256', kid: 'k1' };
    await expect(verify(sign(rotated.privateKey, header, claims()))).rejects.toThrow(/signature/);
    await expect(verify(sign(current.privateKey, header, claims({ iss: 'https://evil.example.com' })))).rejects.toThrow(/issuer/);
    await expect(verify(sign(current.privateKey, header, claims({ aud: 'someone-else' })))).rejects.toThrow(/audience/);
    await expect(verify(sign(current.privateKey, header, claims({ nonce: 'replayed' })))).rejects.toThrow(/nonce/);
    await expect(verify(sign(current.privateKey, header, claims({ exp: now - 10 })))).rejects.toThrow(/expired/);
  });

  it('rejects non-RS256 algorithms (including "none")', async () => {
    await expect(verify(sign(current.privateKey, { alg: 'none', kid: 'k1' }, claims()))).rejects.toThrow(/algorithm/);
    await expect(verify(sign(current.privateKey, { alg: 'HS256', kid: 'k1' }, claims()))).rejects.toThrow(/algorithm/);
  });

  it('does not fall back to another key when the kid is unknown', async () => {
    const forged = sign(rotated.privateKey, { alg: 'RS256', kid: 'unknown' }, claims());
    await expect(verify(forged)).rejects.toThrow(/signing key not found/);
  });

  it('refetches the JWKS once when the IdP has rotated keys', async () => {
    await verify(sign(current.privateKey, { alg: 'RS256', kid: 'k1' }, claims())); // warms the cache with [k1]
    published = [current.jwk, rotated.jwk];
    await expect(verify(sign(rotated.privateKey, { alg: 'RS256', kid: 'k2' }, claims()))).resolves.toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('accepts a token without kid only when the IdP publishes a single key', async () => {
    await expect(verify(sign(current.privateKey, { alg: 'RS256' }, claims()))).resolves.toBeTruthy();
    published = [current.jwk, rotated.jwk];
    (service as any).jwksCache.clear();
    await expect(verify(sign(current.privateKey, { alg: 'RS256' }, claims()))).rejects.toThrow(/signing key not found/);
  });

  it('requires email_verified, unless the provider is pinned to company domains and the claim is absent', async () => {
    const header = { alg: 'RS256', kid: 'k1' };
    await expect(verify(sign(current.privateKey, header, claims({ email_verified: false })), true)).rejects.toThrow(/not verified/);
    await expect(verify(sign(current.privateKey, header, claims({ email_verified: undefined })), false)).rejects.toThrow(/not verified/);
    await expect(verify(sign(current.privateKey, header, claims({ email_verified: undefined })), true)).resolves.toBeTruthy();
    await expect(verify(sign(current.privateKey, header, claims({ email_verified: 'true' })))).resolves.toBeTruthy();
  });
});

describe('SSO browser binding', () => {
  it('only accepts the nonce issued to this browser', () => {
    const { nonce, bind } = browserBinding();
    expect(() => assertBrowserBinding(bind, nonce)).not.toThrow();
    expect(() => assertBrowserBinding(bind, browserBinding().nonce)).toThrow(/different browser/);
    expect(() => assertBrowserBinding(bind, undefined)).toThrow(/not found/);
    expect(() => assertBrowserBinding(undefined, nonce)).toThrow(/not found/);
  });
});
