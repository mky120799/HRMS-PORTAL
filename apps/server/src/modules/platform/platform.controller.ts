import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { AuditService } from '../../common/audit/audit.service';
import { CurrentUser, Permissions } from '../../common/auth/decorators';
import type { AuthUser } from '../../common/auth/auth-user';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { paginate, paged, paginationSchema } from '../../common/validation/common.schemas';

const listSchema = paginationSchema.extend({ search: z.string().trim().max(100).optional() });
const statusSchema = z.object({ isActive: z.boolean() });

/**
 * Platform-operator endpoints (SUPER_ADMIN only). Operators see tenant-level
 * metadata and counts — never employees' personal data.
 */
@ApiTags('Platform')
@ApiBearerAuth()
@Controller('platform')
@Permissions('platform.manage')
export class PlatformController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly audit: AuditService,
  ) {}

  @Get('tenants')
  async tenants(@Query(new ZodValidationPipe(listSchema)) q: z.infer<typeof listSchema>) {
    const where = q.search ? { OR: [{ name: { contains: q.search, mode: 'insensitive' as const } }, { slug: { contains: q.search, mode: 'insensitive' as const } }] } : {};
    const [items, total] = await Promise.all([
      this.prisma.tenant.findMany({
        where,
        select: {
          id: true, name: true, slug: true, isActive: true, createdAt: true, subscriptionPlan: true, subscriptionStatus: true, trialEndsAt: true,
          _count: { select: { users: true, employees: true } },
        },
        orderBy: { createdAt: 'desc' },
        ...paginate(q),
      }),
      this.prisma.tenant.count({ where }),
    ]);
    return paged(items, total, q);
  }

  @Patch('tenants/:id')
  async setStatus(@CurrentUser() operator: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(statusSchema)) dto: { isActive: boolean }) {
    const tenant = await this.prisma.tenant.update({ where: { id }, data: { isActive: dto.isActive }, select: { id: true, isActive: true } });
    this.tenantContext.invalidate(id);
    await this.audit.log({ tenantId: id, userId: operator.userId, action: dto.isActive ? 'TENANT_REACTIVATED' : 'TENANT_SUSPENDED', resource: 'platform', resourceId: id });
    return tenant;
  }
}
