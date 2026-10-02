import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { TenantIdentityProvider } from '@prisma/client';
import { createHash, createPublicKey, createVerify, randomBytes, timingSafeEqual } from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TokenService } from '../../common/auth/token.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { outboundFetch, OutboundUrlError, type OutboundPolicy } from '../../common/net/outbound-url';
import { AuthService, type RequestMeta, type SsoFailureContext } from './auth.service';
import { stringList } from './sso-mapping';

export type OidcDiscovery = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
};

type Jwk = {
  kid?: string;
  kty: string;
  alg?: string;
  use?: string;
  n?: string;
  e?: string;
};

type IdTokenHeader = {
  alg: string;
  kid?: string;
};

export type IdTokenClaims = {
  iss: string;
  aud: string | string[];
  exp: number;
  iat?: number;
  nonce?: string;
  email?: string;
  email_verified?: boolean | string;
  preferred_username?: string;
  upn?: string;
  name?: string;
  groups?: unknown;
  roles?: unknown;
};

/** What the browser must present (via the hrms_sso cookie) to finish the flow it started. */
export interface SsoStart {
  url: string;
  browserNonce: string;
}

const GOOGLE_ISSUER = 'https://accounts.google.com';
const CACHE_MS = 60 * 60_000;

const decodeJson = <T>(segment: string): T => {
  try {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as T;
  } catch {
    throw new UnauthorizedException('Invalid identity token');
  }
};

const digest = (value: string) => createHash('sha256').update(value).digest('base64url');

/** Binds the signed SSO state to the browser that started the flow (login-CSRF protection). */
export function browserBinding(): { nonce: string; bind: string } {
  const nonce = randomBytes(24).toString('base64url');
  return { nonce, bind: digest(nonce) };
}

export function assertBrowserBinding(bind: unknown, browserNonce: string | undefined) {
  if (typeof bind !== 'string' || !browserNonce) {
    throw new UnauthorizedException('SSO session not found in this browser. Start the sign-in again.');
  }
  const expected = Buffer.from(bind);
  const presented = Buffer.from(digest(browserNonce));
  if (expected.length !== presented.length || !timingSafeEqual(expected, presented)) {
    throw new UnauthorizedException('SSO sign-in was started in a different browser. Start the sign-in again.');
  }
}

/**
 * Provider-neutral OpenID Connect (authorization-code flow). Tenant-configured
 * providers (Okta, Entra ID, Google Workspace, Auth0, Keycloak…) and the
 * platform's built-in "Sign in with Google" use the same verified code path.
 */
@Injectable()
export class OidcAuthService {
  private readonly discoveryCache = new Map<string, { value: OidcDiscovery; expiresAt: number }>();
  private readonly jwksCache = new Map<string, { value: Jwk[]; expiresAt: number }>();
  private readonly outbound: OutboundPolicy;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly crypto: CryptoService,
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {
    this.outbound = {
      allowPrivate: this.config.get<boolean>('ALLOW_PRIVATE_IDP_URLS') === true,
      requireHttps: this.config.get<string>('NODE_ENV') === 'production',
    };
  }

  async publicProviders(tenantRef: string) {
    const tenant = await this.auth.resolveTenant(tenantRef);
    if (!tenant || !tenant.isActive) {
      return { tenant: null, googleEnabled: false, oidc: [], saml: [] };
    }
    const policy = await this.prisma.tenantAuthPolicy.upsert({
      where: { tenantId: tenant.id },
      update: {},
      create: { tenantId: tenant.id },
    });
    const providers = await this.prisma.tenantIdentityProvider.findMany({
      where: { tenantId: tenant.id, providerType: { in: ['OIDC', 'SAML'] }, isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, providerType: true, allowedDomains: true },
    });
    return {
      tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name },
      googleEnabled: policy.allowGoogleLogin && this.googleConfigured(),
      oidc: providers.filter((provider) => provider.providerType === 'OIDC'),
      saml: providers.filter((provider) => provider.providerType === 'SAML'),
    };
  }

  async discoverByEmail(email: string) {
    if (!email || !email.includes('@')) return { workspaces: [] };
    const domain = email.toLowerCase().split('@').at(-1);
    if (!domain) return { workspaces: [] };
    const providers = await this.prisma.tenantIdentityProvider.findMany({
      where: {
        providerType: { in: ['OIDC', 'SAML'] },
        isActive: true,
        allowedDomains: { has: domain },
        tenant: { isActive: true },
      },
      include: { tenant: { select: { id: true, name: true, slug: true } } },
      orderBy: { name: 'asc' },
    });
    const byTenant = new Map<string, { id: string; name: string; slug: string; providers: { id: string; name: string; providerType: string }[] }>();
    for (const provider of providers) {
      const current =
        byTenant.get(provider.tenantId) ??
        {
          id: provider.tenant.id,
          name: provider.tenant.name,
          slug: provider.tenant.slug,
          providers: [],
        };
      current.providers.push({ id: provider.id, name: provider.name, providerType: provider.providerType });
      byTenant.set(provider.tenantId, current);
    }
    return { workspaces: [...byTenant.values()] };
  }

  // ─── Tenant-configured OIDC providers ──────────────────────────────────────

  async authorizationUrl(tenantRef: string, providerId: string): Promise<SsoStart> {
    const { tenant, provider } = await this.activeProvider(tenantRef, providerId);
    const discovery = await this.discovery(provider.issuerUrl!);
    const nonce = randomBytes(16).toString('base64url');
    const binding = browserBinding();
    const state = this.tokens.sign('sso_state', {
      sub: 'oidc',
      tenant: tenant.slug,
      tenantId: tenant.id,
      providerId: provider.id,
      nonce,
      bind: binding.bind,
    });
    return {
      url: this.buildAuthorizationUrl(discovery, provider.clientId!, this.callbackUrl(), state, nonce),
      browserNonce: binding.nonce,
    };
  }

  async callback(code: string | undefined, state: string | undefined, browserNonce: string | undefined, meta: RequestMeta) {
    const ctx: SsoFailureContext = { method: 'oidc' };
    try {
      if (!code || !state) throw new BadRequestException('Missing OIDC callback parameters');
      const payload = this.tokens.verify<{ tenantId: string; providerId: string; nonce: string; bind?: string }>('sso_state', state);
      if (payload.sub !== 'oidc') throw new UnauthorizedException('Invalid SSO state');
      ctx.tenantId = payload.tenantId;
      ctx.providerId = payload.providerId;
      assertBrowserBinding(payload.bind, browserNonce);
      const provider = await this.prisma.tenantIdentityProvider.findFirst({
        where: {
          id: payload.providerId,
          tenantId: payload.tenantId,
          providerType: 'OIDC',
          isActive: true,
        },
      });
      if (!provider?.issuerUrl || !provider.clientId) throw new UnauthorizedException('Identity provider is not active');
      const clientSecret = this.crypto.decryptOptional(provider.clientSecretEnc);
      if (!clientSecret) throw new ServiceUnavailableException('OIDC client credentials are not configured');

      const discovery = await this.discovery(provider.issuerUrl);
      const idToken = await this.exchangeCode(discovery, provider.clientId, clientSecret, this.callbackUrl(), code);
      const claims = await this.verifyIdToken(discovery, provider.clientId, idToken, payload.nonce, {
        // Entra ID omits email_verified; accept that only when the provider is
        // pinned to the company's own domains, which the tenant controls.
        allowMissingEmailVerified: provider.allowedDomains.length > 0,
      });
      const email = this.emailFromClaims(claims);
      this.assertAllowedDomain(provider, email);
      return await this.auth.enterpriseSsoLogin(provider, email, 'oidc', meta, {
        name: claims.name,
        groups: [...stringList(claims.groups), ...stringList(claims.roles)],
      });
    } catch (error) {
      await this.auth.recordSsoFailure(ctx, error, meta);
      throw error;
    }
  }

  // ─── Built-in Google sign-in ───────────────────────────────────────────────

  googleConfigured() {
    return !!this.config.get<string>('GOOGLE_CLIENT_ID') && !!this.config.get<string>('GOOGLE_CLIENT_SECRET');
  }

  /** Google is a standard OIDC issuer, so it shares discovery, signature and nonce checks with tenant providers. */
  async googleAuthorizationUrl(tenantRef: string): Promise<SsoStart> {
    if (!this.googleConfigured()) throw new ServiceUnavailableException('Google sign-in is not configured');
    const tenant = await this.auth.resolveTenant(tenantRef);
    if (!tenant || !tenant.isActive) throw new UnauthorizedException('Workspace not found');
    const discovery = await this.discovery(GOOGLE_ISSUER);
    const nonce = randomBytes(16).toString('base64url');
    const binding = browserBinding();
    const state = this.tokens.sign('sso_state', {
      sub: 'google',
      tenant: tenant.slug,
      tenantId: tenant.id,
      nonce,
      bind: binding.bind,
    });
    return {
      url: this.buildAuthorizationUrl(discovery, this.config.get<string>('GOOGLE_CLIENT_ID')!, this.googleCallbackUrl(), state, nonce),
      browserNonce: binding.nonce,
    };
  }

  async googleCallback(code: string | undefined, state: string | undefined, browserNonce: string | undefined, meta: RequestMeta) {
    const ctx: SsoFailureContext = { method: 'google' };
    try {
      if (!code || !state) throw new BadRequestException('Missing Google callback parameters');
      if (!this.googleConfigured()) throw new ServiceUnavailableException('Google sign-in is not configured');
      const payload = this.tokens.verify<{ tenantId: string; nonce: string; bind?: string }>('sso_state', state);
      if (payload.sub !== 'google') throw new UnauthorizedException('Invalid SSO state');
      ctx.tenantId = payload.tenantId;
      assertBrowserBinding(payload.bind, browserNonce);
      const clientId = this.config.get<string>('GOOGLE_CLIENT_ID')!;
      const discovery = await this.discovery(GOOGLE_ISSUER);
      const idToken = await this.exchangeCode(discovery, clientId, this.config.get<string>('GOOGLE_CLIENT_SECRET')!, this.googleCallbackUrl(), code);
      const claims = await this.verifyIdToken(discovery, clientId, idToken, payload.nonce, { allowMissingEmailVerified: false });
      return await this.auth.ssoLogin(payload.tenantId, this.emailFromClaims(claims));
    } catch (error) {
      await this.auth.recordSsoFailure(ctx, error, meta);
      throw error;
    }
  }

  // ─── Shared OIDC mechanics ─────────────────────────────────────────────────

  private buildAuthorizationUrl(discovery: OidcDiscovery, clientId: string, redirectUri: string, state: string, nonce: string) {
    const url = new URL(discovery.authorization_endpoint);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('state', state);
    url.searchParams.set('nonce', nonce);
    url.searchParams.set('prompt', 'select_account');
    return url.toString();
  }

  private async activeProvider(tenantRef: string, providerId: string) {
    const tenant = await this.auth.resolveTenant(tenantRef);
    if (!tenant || !tenant.isActive) throw new UnauthorizedException('Workspace not found');
    const provider = await this.prisma.tenantIdentityProvider.findFirst({
      where: {
        id: providerId,
        tenantId: tenant.id,
        providerType: 'OIDC',
        isActive: true,
      },
    });
    if (!provider) throw new UnauthorizedException('Identity provider is not active');
    if (!provider.issuerUrl || !provider.clientId) {
      throw new ServiceUnavailableException('OIDC provider is not fully configured');
    }
    return { tenant, provider };
  }

  private callbackUrl() {
    return (
      this.config.get<string>('OIDC_CALLBACK_URL') ??
      `${this.apiBaseUrl()}/api/v1/auth/oidc/callback`
    );
  }

  private googleCallbackUrl() {
    return this.config.get<string>('GOOGLE_CALLBACK_URL') ?? `${this.apiBaseUrl()}/api/v1/auth/google/callback`;
  }

  private apiBaseUrl() {
    return (this.config.get<string>('API_PUBLIC_URL') ?? 'http://localhost:3000').replace(/\/+$/, '');
  }

  private async fetchJson(url: string, init: RequestInit = {}) {
    try {
      return await outboundFetch(url, { ...init, headers: { accept: 'application/json', ...(init.headers ?? {}) } }, this.outbound);
    } catch (error) {
      if (error instanceof OutboundUrlError) throw new ServiceUnavailableException(`Identity provider URL rejected: ${error.message}`);
      throw new ServiceUnavailableException('Identity provider is unreachable');
    }
  }

  async discovery(issuerUrl: string): Promise<OidcDiscovery> {
    const issuer = issuerUrl.replace(/\/+$/, '');
    const cached = this.discoveryCache.get(issuer);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const response = await this.fetchJson(`${issuer}/.well-known/openid-configuration`);
    if (!response.ok) throw new ServiceUnavailableException('Could not load OIDC discovery document');
    const body = (await response.json()) as Partial<OidcDiscovery>;
    if (
      body.issuer?.replace(/\/+$/, '') !== issuer ||
      !body.authorization_endpoint ||
      !body.token_endpoint ||
      !body.jwks_uri
    ) {
      throw new ServiceUnavailableException('OIDC discovery document is invalid');
    }
    const value: OidcDiscovery = {
      issuer: body.issuer,
      authorization_endpoint: body.authorization_endpoint,
      token_endpoint: body.token_endpoint,
      jwks_uri: body.jwks_uri,
    };
    this.discoveryCache.set(issuer, { value, expiresAt: Date.now() + CACHE_MS });
    return value;
  }

  private async exchangeCode(discovery: OidcDiscovery, clientId: string, clientSecret: string, redirectUri: string, code: string) {
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    });
    const response = await this.fetchJson(discovery.token_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: params,
    });
    if (!response.ok) throw new UnauthorizedException('OIDC token exchange failed');
    const body = (await response.json()) as { id_token?: string };
    if (!body.id_token) throw new UnauthorizedException('OIDC provider did not return an ID token');
    return body.id_token;
  }

  async verifyIdToken(
    discovery: OidcDiscovery,
    clientId: string,
    idToken: string,
    expectedNonce: string,
    opts: { allowMissingEmailVerified: boolean },
  ): Promise<IdTokenClaims> {
    const parts = idToken.split('.');
    if (parts.length !== 3) throw new UnauthorizedException('Invalid identity token');
    const header = decodeJson<IdTokenHeader>(parts[0]);
    const claims = decodeJson<IdTokenClaims>(parts[1]);
    if (header.alg !== 'RS256') {
      throw new UnauthorizedException('Unsupported OIDC signing algorithm');
    }
    const jwk = await this.signingKey(discovery.jwks_uri, header.kid);
    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${parts[0]}.${parts[1]}`);
    verifier.end();
    let ok = false;
    try {
      ok = verifier.verify(createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(parts[2], 'base64url'));
    } catch {
      ok = false;
    }
    if (!ok) throw new UnauthorizedException('Invalid identity token signature');
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (claims.iss !== discovery.issuer) throw new UnauthorizedException('Invalid identity token issuer');
    if (typeof claims.exp !== 'number' || claims.exp <= nowSeconds) throw new UnauthorizedException('Identity token expired');
    if (claims.iat && claims.iat > nowSeconds + 300) throw new UnauthorizedException('Identity token issued in the future');
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!audiences.includes(clientId)) {
      throw new UnauthorizedException('Invalid identity token audience');
    }
    if (claims.nonce !== expectedNonce) throw new UnauthorizedException('Invalid SSO nonce');
    const verified = claims.email_verified === true || claims.email_verified === 'true';
    const missing = claims.email_verified === undefined;
    if (!verified && !(missing && opts.allowMissingEmailVerified)) {
      throw new UnauthorizedException('OIDC email is not verified');
    }
    return claims;
  }

  /**
   * Selects the signing key strictly by `kid`. An unknown `kid` usually means the
   * IdP rotated keys, so the JWKS is refetched once before failing. A token
   * without `kid` is only accepted when the IdP publishes exactly one RSA key.
   */
  private async signingKey(jwksUri: string, kid: string | undefined): Promise<Jwk> {
    const pick = (keys: Jwk[]) => {
      const rsa = keys.filter((key) => key.kty === 'RSA' && key.use !== 'enc' && (!key.alg || key.alg === 'RS256'));
      if (kid) return rsa.find((key) => key.kid === kid);
      return rsa.length === 1 ? rsa[0] : undefined;
    };
    const key = pick(await this.jwks(jwksUri, false)) ?? (kid ? pick(await this.jwks(jwksUri, true)) : undefined);
    if (!key) throw new UnauthorizedException('OIDC signing key not found');
    return key;
  }

  private async jwks(jwksUri: string, forceRefresh: boolean) {
    const cached = this.jwksCache.get(jwksUri);
    if (!forceRefresh && cached && cached.expiresAt > Date.now()) return cached.value;
    const response = await this.fetchJson(jwksUri);
    if (!response.ok) throw new ServiceUnavailableException('Could not load OIDC signing keys');
    const body = (await response.json()) as { keys?: Jwk[] };
    if (!Array.isArray(body.keys)) throw new ServiceUnavailableException('OIDC signing keys are invalid');
    this.jwksCache.set(jwksUri, { value: body.keys, expiresAt: Date.now() + CACHE_MS });
    return body.keys;
  }

  private emailFromClaims(claims: IdTokenClaims) {
    const email = claims.email ?? claims.preferred_username ?? claims.upn;
    if (!email || !email.includes('@')) {
      throw new UnauthorizedException('OIDC provider did not return an email address');
    }
    return email.toLowerCase();
  }

  private assertAllowedDomain(provider: TenantIdentityProvider, email: string) {
    if (!provider.allowedDomains.length) return;
    const domain = email.split('@').at(-1)?.toLowerCase();
    if (!domain || !provider.allowedDomains.map((value) => value.toLowerCase()).includes(domain)) {
      throw new ForbiddenException('This email domain is not allowed for the identity provider');
    }
  }
}
