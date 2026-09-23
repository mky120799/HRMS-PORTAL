import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { CreateTenantDto } from './dto/create-tenant.dto';

@Injectable()
export class TenantsService {
  constructor(private prisma: PrismaService) {}

  async createTenant(dto: CreateTenantDto) {
    const slug = dto.slug || dto.name.toLowerCase().replace(/ /g, '-').replace(/[^\w-]/g, '');
    
    let row = await this.prisma.tenant.findUnique({ where: { slug } });
    if (!row) {
      // Every new tenant starts on a FREE plan with a 30-day full-access trial
      const trialEndsAt = new Date();
      trialEndsAt.setDate(trialEndsAt.getDate() + 30);

      row = await this.prisma.tenant.create({
        data: {
          name: dto.name,
          slug,
          subscriptionStatus: 'TRIAL',
          subscriptionPlan: 'FREE',
          trialEndsAt,
        },
      });
    }
    
    return row;
  }

  async getTenantById(id: string) {
    const row = await this.prisma.tenant.findUnique({ where: { id } });
    if (!row) {
      throw new NotFoundException('Tenant not found');
    }
    return row;
  }

  async lookupTenant(identifier: string) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier);
    
    let tenant = null;
    if (isUuid) {
      tenant = await this.prisma.tenant.findUnique({ where: { id: identifier } });
    }
    
    if (!tenant) {
      tenant = await this.prisma.tenant.findUnique({ where: { slug: identifier } });
    }
  
    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }
  
    return tenant;
  }

  async getSubscriptionStatus(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        subscriptionPlan: true,
        subscriptionStatus: true,
        trialEndsAt: true,
      },
    });

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    const now = new Date();
    const isTrialActive =
      tenant.subscriptionStatus === 'TRIAL' &&
      !!tenant.trialEndsAt &&
      now < tenant.trialEndsAt;

    const trialDaysRemaining = isTrialActive && tenant.trialEndsAt
      ? Math.ceil((tenant.trialEndsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
      : 0;

    return {
      plan: tenant.subscriptionPlan,
      status: tenant.subscriptionStatus,
      trialEndsAt: tenant.trialEndsAt,
      isTrialActive,
      trialDaysRemaining,
    };
  }
}
