import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SAML, ValidateInResponseTo } from '@node-saml/node-saml';
import type { TenantIdentityProvider } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TokenService } from '../../common/auth/token.service';
import { ReplayGuardService } from '../../common/auth/replay-guard.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { AuthService, type RequestMeta, type SsoFailureContext } from './auth.service';
import { assertBrowserBinding, browserBinding, type SsoStart } from './oidc-auth.service';
import { checkSamlAddressing, SamlCheckError } from './saml-checks';
import { samlIdentity } from './sso-mapping';

/**
 * SAML 2.0 service provider (SP-initiated, HTTP-POST binding).
 *
 * `@node-saml/node-saml` verifies the XML signature, issuer, audience and
 * timestamps. HRMS adds what the library leaves to the application:
 * Destination/Recipient (the response was meant for this ACS URL), single-use
 * assertions (replay), browser binding of the RelayState, and attribute mapping.
 */
@Injectable()
export class SamlAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly crypto: CryptoService,
    private readonly auth: AuthService,
    private readonly replayGuard: ReplayGuardService,
    private readonly config: ConfigService,
  ) {}

  async metadata(providerId: string) {
    const provider = await this.providerById(providerId);
    return this.saml(provider).generateServiceProviderMetadata(null);
  }

  async authorizationUrl(tenantRef: string, providerId: string): Promise<SsoStart> {
    const { tenant, provider } = await this.activeProvider(tenantRef, providerId);
    const binding = browserBinding();
    const relayState = this.tokens.sign('sso_state', {
      sub: 'saml',
      tenant: tenant.slug,
      tenantId: tenant.id,
      providerId: provider.id,
      bind: binding.bind,
    });
    return {
      url: await this.saml(provider).getAuthorizeUrlAsync(relayState, undefined, {}),
      browserNonce: binding.nonce,
    };
  }

  async callback(providerId: string, body: Record<string, unknown>, browserNonce: string | undefined, meta: RequestMeta) {
    const ctx: SsoFailureContext = { method: 'saml', providerId };
    try {
      const relayState = typeof body.RelayState === 'string' ? body.RelayState : undefined;
      const samlResponse = typeof body.SAMLResponse === 'string' ? body.SAMLResponse : undefined;
      if (!relayState || !samlResponse) {
        throw new BadRequestException('Missing SAMLResponse or RelayState');
      }
      const state = this.tokens.verify<{ tenantId: string; providerId: string; bind?: string }>('sso_state', relayState);
      if (state.sub !== 'saml' || state.providerId !== providerId) {
        throw new UnauthorizedException('Invalid SAML relay state');
      }
      ctx.tenantId = state.tenantId;
      assertBrowserBinding(state.bind, browserNonce);
      const provider = await this.prisma.tenantIdentityProvider.findFirst({
        where: {
          id: providerId,
          tenantId: state.tenantId,
          providerType: 'SAML',
          isActive: true,
        },
      });
      if (!provider) throw new UnauthorizedException('SAML provider is not active');

      const { profile } = await this.saml(provider).validatePostResponseAsync({ SAMLResponse: samlResponse });
      if (!profile?.getAssertionXml || !profile.getSamlResponseXml) throw new UnauthorizedException('Invalid SAML response');

      let addressing: ReturnType<typeof checkSamlAddressing>;
      try {
        addressing = checkSamlAddressing(profile.getSamlResponseXml(), profile.getAssertionXml(), this.callbackUrl(provider.id));
      } catch (error) {
        if (error instanceof SamlCheckError) throw new UnauthorizedException(error.message);
        throw error;
      }
      const firstUse = await this.replayGuard.consume(`saml:${provider.id}:${addressing.assertionId}`, addressing.acceptableUntil);
      if (!firstUse) throw new UnauthorizedException('SAML assertion has already been used');

      const identity = samlIdentity(profile as unknown as Record<string, unknown>, provider.attributeMapping);
      if (!identity.email) throw new UnauthorizedException('SAML assertion did not contain an email address');
      return await this.auth.enterpriseSsoLogin(provider, identity.email, 'saml', meta, {
        name: identity.name,
        groups: identity.groups,
      });
    } catch (error) {
      await this.auth.recordSsoFailure(ctx, error, meta);
      throw error;
    }
  }

  private async activeProvider(tenantRef: string, providerId: string) {
    const tenant = await this.auth.resolveTenant(tenantRef);
    if (!tenant || !tenant.isActive) throw new UnauthorizedException('Workspace not found');
    const provider = await this.prisma.tenantIdentityProvider.findFirst({
      where: {
        id: providerId,
        tenantId: tenant.id,
        providerType: 'SAML',
        isActive: true,
      },
    });
    if (!provider) throw new UnauthorizedException('SAML provider is not active');
    return { tenant, provider };
  }

  private async providerById(providerId: string) {
    const provider = await this.prisma.tenantIdentityProvider.findFirst({
      where: { id: providerId, providerType: 'SAML', isActive: true, tenant: { isActive: true } },
    });
    if (!provider) throw new UnauthorizedException('SAML provider is not active');
    return provider;
  }

  private saml(provider: TenantIdentityProvider) {
    const cert = this.crypto.decryptOptional(provider.samlCertificateEnc);
    if (!provider.samlSsoUrl || !provider.samlEntityId || !cert) {
      throw new ServiceUnavailableException('SAML provider is not fully configured');
    }
    return new SAML({
      entryPoint: provider.samlSsoUrl,
      idpCert: cert,
      idpIssuer: provider.samlEntityId,
      issuer: this.spEntityId(provider.id),
      audience: this.spEntityId(provider.id),
      callbackUrl: this.callbackUrl(provider.id),
      identifierFormat: null,
      wantAssertionsSigned: true,
      wantAuthnResponseSigned: false,
      acceptedClockSkewMs: 120_000,
      maxAssertionAgeMs: 5 * 60_000,
      // InResponseTo needs a request-ID cache shared by all instances; replay is
      // instead blocked by recording each assertion ID (ReplayGuardService) and
      // CSRF by the browser-bound RelayState.
      validateInResponseTo: ValidateInResponseTo.never,
      signatureAlgorithm: 'sha256',
    });
  }

  callbackUrl(providerId: string) {
    return `${this.apiBaseUrl()}/api/v1/auth/saml/callback/${providerId}`;
  }

  private spEntityId(providerId: string) {
    return `${this.apiBaseUrl()}/api/v1/auth/saml/metadata/${providerId}`;
  }

  private apiBaseUrl() {
    return (this.config.get<string>('API_PUBLIC_URL') ?? 'http://localhost:3000').replace(/\/+$/, '');
  }
}
