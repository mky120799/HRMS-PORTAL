import { Controller, Get, Post, Body, Param, UseGuards, UsePipes, Req } from '@nestjs/common';
import { TenantsService } from './tenants.service';
import { InternalAuthGuard } from '../../common/guards/internal-auth.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { createTenantSchema } from './dto/create-tenant.dto';
import type { CreateTenantDto } from './dto/create-tenant.dto';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';

// ── Internal endpoints (service-to-service) ───────────────────────────────────
@Controller('internal/tenants')
@UseGuards(InternalAuthGuard)
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Post()
  @UsePipes(new ZodValidationPipe(createTenantSchema))
  async createTenant(@Body() dto: CreateTenantDto) {
    return this.tenantsService.createTenant(dto);
  }

  @Get(':id')
  async getTenantById(@Param('id') id: string) {
    return this.tenantsService.getTenantById(id);
  }

  @Get('lookup/:identifier')
  async lookupTenant(@Param('identifier') identifier: string) {
    return this.tenantsService.lookupTenant(identifier);
  }
}

// ── Authenticated endpoints (for logged-in users) ─────────────────────────────
import { Controller as PublicController } from '@nestjs/common';

@PublicController('tenants')
@UseGuards(JwtAuthGuard)
export class TenantsSelfController {
  constructor(private readonly tenantsService: TenantsService) {}

  /**
   * GET /tenants/subscription
   * Returns the current tenant's plan, status, trial expiry, and days remaining.
   * Used by the frontend to show upgrade banners and gate UI sections.
   */
  @Get('subscription')
  async getSubscription(@Req() req: any) {
    return this.tenantsService.getSubscriptionStatus(req.user.tenantId);
  }
}
