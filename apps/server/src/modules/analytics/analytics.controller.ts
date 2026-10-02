import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { CurrentTenant, CurrentUser, Permissions } from '../../common/auth/decorators';
import type { AuthUser } from '../../common/auth/auth-user';
import type { TenantSnapshot } from '../../common/tenant/tenant-context.service';
import { RequiresPlan } from '../../common/decorators/plan.decorator';

@ApiTags('Analytics')
@ApiBearerAuth()
@Controller('analytics')
@RequiresPlan('BUSINESS')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('overview')
  @Permissions('analytics.read')
  overview(@CurrentUser() user: AuthUser, @CurrentTenant() tenant: TenantSnapshot) {
    return this.analytics.overview(user.tenantId, tenant.timezone);
  }

  @Get('hiring')
  @Permissions('analytics.read')
  hiring(@CurrentUser() user: AuthUser) {
    return this.analytics.hiringMetrics(user.tenantId);
  }
}
