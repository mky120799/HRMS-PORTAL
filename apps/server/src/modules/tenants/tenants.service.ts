import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { AuditService } from '../../common/audit/audit.service';
import { ipMatchesAny } from '../../common/utils/ip-match';
import { effectivePlan, employeeLimit, isTrialActive } from '../../common/subscription/subscription-plans';
import type { AuthUser } from '../../common/auth/auth-user';
import type { UpdateSettingsDto } from './dto/tenant.dto';

const mask = (url: string | null) => (url ? `${url.slice(0, 34)}…${url.slice(-4)}` : null);

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
}
