import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { AuditService } from '../../common/audit/audit.service';
import { ipMatchesAny } from '../../common/utils/ip-match';
import { effectivePlan, employeeLimit, isTrialActive } from '../../common/subscription/subscription-plans';
import type { AuthUser } from '../../common/auth/auth-user';
import type { IdentityProviderDto, UpdateAuthPolicyDto, UpdateIdentityProviderDto, UpdateSettingsDto } from './dto/tenant.dto';

const mask = (url: string | null) => (url ? `${url.slice(0, 34)}…${url.slice(-4)}` : null);
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

@Injectable()
export class TenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly tenantContext: TenantContextService,
    private readonly audit: AuditService,
  ) {}

  async getSubscriptionStatus(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Tenant not found');
    const now = new Date();
    const trialActive = isTrialActive(tenant, now);
    const activeEmployees = await this.prisma.employee.count({ where: { tenantId, status: { not: 'EXITED' } } });
    return {
      plan: tenant.subscriptionPlan,
      status: tenant.subscriptionStatus,
      effectivePlan: effectivePlan(tenant, now),
      trialEndsAt: tenant.trialEndsAt,
      isTrialActive: trialActive,
      trialDaysRemaining: trialActive && tenant.trialEndsAt ? Math.ceil((tenant.trialEndsAt.getTime() - now.getTime()) / 86_400_000) : 0,
      employeeLimit: Number.isFinite(employeeLimit(tenant, now)) ? employeeLimit(tenant, now) : null,
      activeEmployees,
      hasBillingAccount: !!tenant.stripeCustomerId,
    };
  }

  async getSettings(tenantId: string) {
    const t = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    return {
      id: t.id,
      name: t.name,
      slug: t.slug,
      timezone: t.timezone,
      whitelistedIps: t.whitelistedIps,
      // Secrets are write-only: we only reveal whether one is set, masked.
      slackWebhookUrl: mask(this.crypto.decryptOptional(t.slackWebhookUrlEnc)),
      slackHiringWebhookUrl: mask(this.crypto.decryptOptional(t.slackHiringWebhookEnc)),
    };
  }

  async updateSettings(user: AuthUser, dto: UpdateSettingsDto, callerIp: string) {
    // Lock-out protection: an admin cannot save an allow-list that excludes their own connection.
    if (dto.whitelistedIps && dto.whitelistedIps.length > 0 && !ipMatchesAny(callerIp, dto.whitelistedIps)) {
      throw new BadRequestException(`The IP allow-list must include your current address (${callerIp}) or you would be locked out.`);
    }
    const before = await this.prisma.tenant.findUniqueOrThrow({ where: { id: user.tenantId } });
    await this.prisma.tenant.update({
      where: { id: user.tenantId },
      data: {
        name: dto.name,
        timezone: dto.timezone,
        whitelistedIps: dto.whitelistedIps,
        slackWebhookUrlEnc: dto.slackWebhookUrl === undefined ? undefined : this.crypto.encryptOptional(dto.slackWebhookUrl),
        slackHiringWebhookEnc: dto.slackHiringWebhookUrl === undefined ? undefined : this.crypto.encryptOptional(dto.slackHiringWebhookUrl),
      },
    });
    this.tenantContext.invalidate(user.tenantId);
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: 'SETTINGS_UPDATED',
      resource: 'tenants',
      resourceId: user.tenantId,
      oldValues: { name: before.name, timezone: before.timezone, whitelistedIps: before.whitelistedIps },
      newValues: {
        name: dto.name,
        timezone: dto.timezone,
        whitelistedIps: dto.whitelistedIps,
        slackWebhookChanged: dto.slackWebhookUrl !== undefined,
        slackHiringWebhookChanged: dto.slackHiringWebhookUrl !== undefined,
      },
    });
    return this.getSettings(user.tenantId);
  }

  getAuthPolicy(tenantId: string) {
    return this.prisma.tenantAuthPolicy.upsert({
      where: { tenantId },
      update: {},
      create: { tenantId },
    });
  }

  async updateAuthPolicy(user: AuthUser, dto: UpdateAuthPolicyDto) {
    if (dto.requireMfaForAdmins || dto.requireMfaForAll) {
      const missingMfa = await this.prisma.user.count({
        where: {
          tenantId: user.tenantId,
          isActive: true,
          isTwoFactorEnabled: false,
          ...(dto.requireMfaForAll ? {} : { role: 'ADMIN' }),
        },
      });
      if (missingMfa > 0) {
        throw new BadRequestException(
          dto.requireMfaForAll
            ? 'Every active user must enable MFA before this policy can be enforced'
            : 'Every active admin must enable MFA before this policy can be enforced',
        );
      }
    }

    const before = await this.getAuthPolicy(user.tenantId);
    const updated = await this.prisma.tenantAuthPolicy.update({
      where: { tenantId: user.tenantId },
      data: dto,
    });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: 'AUTH_POLICY_UPDATED',
      resource: 'tenant_auth_policy',
      resourceId: updated.id,
      oldValues: before,
      newValues: dto,
    });
    return updated;
  }

  async identityProviders(tenantId: string) {
    const providers = await this.prisma.tenantIdentityProvider.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
    return providers.map((provider) => ({
      ...provider,
      clientSecretConfigured: !!provider.clientSecretEnc,
      samlCertificateConfigured: !!provider.samlCertificateEnc,
      clientSecretEnc: undefined,
      samlCertificateEnc: undefined,
      scimTokenHash: provider.scimTokenHash ? '[configured]' : null,
    }));
  }

  async createIdentityProvider(user: AuthUser, dto: IdentityProviderDto) {
    const provider = await this.prisma.tenantIdentityProvider.create({
      data: {
        tenantId: user.tenantId,
        providerType: dto.providerType,
        name: dto.name,
        issuerUrl: dto.issuerUrl,
        clientId: dto.clientId,
        clientSecretEnc: this.crypto.encryptOptional(dto.clientSecret),
        samlEntityId: dto.samlEntityId,
        samlSsoUrl: dto.samlSsoUrl,
        samlCertificateEnc: this.crypto.encryptOptional(dto.samlCertificate),
        allowedDomains: dto.allowedDomains,
        roleMapping: dto.roleMapping ?? undefined,
        attributeMapping: dto.attributeMapping ?? undefined,
        jitProvisioning: dto.jitProvisioning,
        scimEnabled: dto.scimEnabled,
        isActive: dto.isActive,
      },
    });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: 'IDENTITY_PROVIDER_CREATED',
      resource: 'tenant_identity_provider',
      resourceId: provider.id,
      newValues: { providerType: provider.providerType, name: provider.name },
    });
    return this.identityProviders(user.tenantId);
  }

  async updateIdentityProvider(user: AuthUser, id: string, dto: UpdateIdentityProviderDto) {
    const existing = await this.prisma.tenantIdentityProvider.findFirst({
      where: { id, tenantId: user.tenantId },
    });
    if (!existing) throw new NotFoundException('Identity provider not found');
    const jitProvisioning = dto.jitProvisioning ?? existing.jitProvisioning;
    const allowedDomains = dto.allowedDomains ?? existing.allowedDomains;
    if (jitProvisioning && allowedDomains.length === 0) {
      throw new BadRequestException('Just-in-time provisioning requires at least one allowed email domain');
    }
    await this.prisma.tenantIdentityProvider.update({
      where: { id },
      data: {
        providerType: dto.providerType,
        name: dto.name,
        issuerUrl: dto.issuerUrl,
        clientId: dto.clientId,
        clientSecretEnc: dto.clientSecret === undefined ? undefined : this.crypto.encryptOptional(dto.clientSecret),
        samlEntityId: dto.samlEntityId,
        samlSsoUrl: dto.samlSsoUrl,
        samlCertificateEnc: dto.samlCertificate === undefined ? undefined : this.crypto.encryptOptional(dto.samlCertificate),
        allowedDomains: dto.allowedDomains,
        roleMapping: dto.roleMapping === null ? Prisma.DbNull : dto.roleMapping,
        attributeMapping: dto.attributeMapping === null ? Prisma.DbNull : dto.attributeMapping,
        jitProvisioning: dto.jitProvisioning,
        scimEnabled: dto.scimEnabled,
        isActive: dto.isActive,
      },
    });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: 'IDENTITY_PROVIDER_UPDATED',
      resource: 'tenant_identity_provider',
      resourceId: id,
      oldValues: { providerType: existing.providerType, name: existing.name, isActive: existing.isActive },
      // Never write secrets (client secret, certificate) into the audit trail.
      newValues: { ...dto, clientSecret: dto.clientSecret === undefined ? undefined : '[changed]', samlCertificate: dto.samlCertificate === undefined ? undefined : '[changed]' },
    });
    return this.identityProviders(user.tenantId);
  }

  async rotateScimToken(user: AuthUser, id: string) {
    const existing = await this.prisma.tenantIdentityProvider.findFirst({
      where: { id, tenantId: user.tenantId },
    });
    if (!existing) throw new NotFoundException('Identity provider not found');
    const token = `scim_${randomBytes(32).toString('base64url')}`;
    await this.prisma.tenantIdentityProvider.update({
      where: { id },
      data: {
        scimEnabled: true,
        scimTokenHash: sha256(token),
      },
    });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: 'SCIM_TOKEN_ROTATED',
      resource: 'tenant_identity_provider',
      resourceId: id,
      newValues: { providerType: existing.providerType, name: existing.name },
    });
    return {
      token,
      message: 'Copy this SCIM bearer token now. It will not be shown again.',
    };
  }
}
