import { Body, Controller, Get, Patch, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { TenantsService } from './tenants.service';
import { TenantDemoSeederService } from './tenant-demo-seeder.service';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import type { AuthUser } from '../../common/auth/auth-user';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { updateSettingsSchema, type UpdateSettingsDto } from './dto/tenant.dto';

@ApiTags('Tenant')
@ApiBearerAuth()
@Controller('tenants')
export class TenantsController {
  constructor(
    private readonly tenants: TenantsService,
    private readonly demoSeeder: TenantDemoSeederService,
  ) {}

  /** Plan, trial and seat usage — drives upgrade banners and feature gating in the UI. */
  @Get('subscription')
  getSubscription(@CurrentUser() user: AuthUser) {
    return this.tenants.getSubscriptionStatus(user.tenantId);
  }

  @Get('settings')
  @Roles('ADMIN')
  getSettings(@CurrentUser() user: AuthUser) {
    return this.tenants.getSettings(user.tenantId);
  }

  @Patch('settings')
  @Roles('ADMIN')
  updateSettings(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(updateSettingsSchema)) dto: UpdateSettingsDto, @Req() req: FastifyRequest) {
    return this.tenants.updateSettings(user, dto, req.ip);
  }

  /** Fills a brand-new workspace with sample data. Admin-only, once, and never changes billing. */
  @Post('seed-demo')
  @Roles('ADMIN')
  async seedDemo(@CurrentUser() user: AuthUser) {
    await this.demoSeeder.seed(user.tenantId);
    return { seeded: true };
  }
}
