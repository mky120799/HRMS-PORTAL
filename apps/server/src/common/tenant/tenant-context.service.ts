import { Injectable } from '@nestjs/common';
import type { SubscriptionPlan, SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface TenantSnapshot {
  id: string;
  slug: string;
  isActive: boolean;
  timezone: string;
  whitelistedIps: string[];
  subscriptionPlan: SubscriptionPlan;
  subscriptionStatus: SubscriptionStatus;
  trialEndsAt: Date | null;
}

const TTL_MS = 30_000;

/**
 * Per-request tenant lookups (suspension, IP allow-list, plan) are served from a
 * small in-process cache. Writes that change these fields call `invalidate()`;
 * other instances converge within TTL_MS, which bounds how long a revoked IP or
 * suspended tenant can keep access.
 */
@Injectable()
export class TenantContextService {
  private readonly cache = new Map<string, { value: TenantSnapshot | null; expires: number }>();

  constructor(private readonly prisma: PrismaService) {}

  async get(tenantId: string): Promise<TenantSnapshot | null> {
    const hit = this.cache.get(tenantId);
    if (hit && hit.expires > Date.now()) return hit.value;

    const value = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        slug: true,
        isActive: true,
        timezone: true,
        whitelistedIps: true,
        subscriptionPlan: true,
        subscriptionStatus: true,
        trialEndsAt: true,
      },
    });
    if (this.cache.size > 10_000) this.cache.clear();
    this.cache.set(tenantId, { value, expires: Date.now() + TTL_MS });
    return value;
  }

  invalidate(tenantId: string) {
    this.cache.delete(tenantId);
  }
}
