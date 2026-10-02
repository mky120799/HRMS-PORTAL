import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { TenantsService } from './tenants.service';
import { TenantDemoSeederService } from './tenant-demo-seeder.service';
import { CurrentUser, Permissions, RequireStepUp } from '../../common/auth/decorators';
import type { AuthUser } from '../../common/auth/auth-user';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  identityProviderSchema,
  updateAuthPolicySchema,
  updateIdentityProviderSchema,
  updateSettingsSchema,
  type IdentityProviderDto,
  type UpdateAuthPolicyDto,
  type UpdateIdentityProviderDto,
  type UpdateSettingsDto,
} from './dto/tenant.dto';

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
  @Permissions('tenant.settings.manage')
  getSettings(@CurrentUser() user: AuthUser) {
    return this.tenants.getSettings(user.tenantId);
  }

  @Patch('settings')
  @Permissions('tenant.settings.manage')
  updateSettings(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(updateSettingsSchema)) dto: UpdateSettingsDto, @Req() req: FastifyRequest) {
    return this.tenants.updateSettings(user, dto, req.ip);
  }

  @Get('auth-policy')
  @Permissions('security.manage')
  authPolicy(@CurrentUser() user: AuthUser) {
    return this.tenants.getAuthPolicy(user.tenantId);
  }

  @Patch('auth-policy')
  @Permissions('security.manage')
  @RequireStepUp()
  updateAuthPolicy(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(updateAuthPolicySchema)) dto: UpdateAuthPolicyDto) {
    return this.tenants.updateAuthPolicy(user, dto);
  }

  @Get('identity-providers')
  @Permissions('identity_providers.manage')
  identityProviders(@CurrentUser() user: AuthUser) {
    return this.tenants.identityProviders(user.tenantId);
  }

  @Post('identity-providers')
  @Permissions('identity_providers.manage')
  @RequireStepUp()
  createIdentityProvider(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(identityProviderSchema)) dto: IdentityProviderDto) {
    return this.tenants.createIdentityProvider(user, dto);
  }

  @Patch('identity-providers/:id')
  @Permissions('identity_providers.manage')
  @RequireStepUp()
  updateIdentityProvider(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(updateIdentityProviderSchema)) dto: UpdateIdentityProviderDto) {
    return this.tenants.updateIdentityProvider(user, id, dto);
  }

  @Post('identity-providers/:id/scim-token')
  @Permissions('identity_providers.manage')
  @RequireStepUp()
  rotateScimToken(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.tenants.rotateScimToken(user, id);
  }

  /** Fills a brand-new workspace with sample data. Admin-only, once, and never changes billing. */
  @Post('seed-demo')
  @Permissions('tenant.settings.manage')
  async seedDemo(@CurrentUser() user: AuthUser) {
    await this.demoSeeder.seed(user.tenantId);
    return { seeded: true };
  }
}
