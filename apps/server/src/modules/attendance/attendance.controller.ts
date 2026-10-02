import { Controller, Get, NotFoundException, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AttendanceService } from './attendance.service';
import { CurrentTenant, CurrentUser, Permissions } from '../../common/auth/decorators';
import type { AuthUser } from '../../common/auth/auth-user';
import type { TenantSnapshot } from '../../common/tenant/tenant-context.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { isoDate } from '../../common/validation/common.schemas';

const rangeQuery = z.object({ from: isoDate.optional(), to: isoDate.optional() });
const dayQuery = z.object({ date: isoDate.optional() });

@ApiTags('Attendance')
@ApiBearerAuth()
@Controller('attendance')
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Post('clock-in')
  clockIn(@CurrentUser() user: AuthUser, @CurrentTenant() tenant: TenantSnapshot) {
    return this.attendance.clockIn(user, tenant);
  }

  @Post('clock-out')
  clockOut(@CurrentUser() user: AuthUser, @CurrentTenant() tenant: TenantSnapshot) {
    return this.attendance.clockOut(user, tenant);
  }

  @Get('me')
  async mine(@CurrentUser() user: AuthUser, @CurrentTenant() tenant: TenantSnapshot, @Query(new ZodValidationPipe(rangeQuery)) q: z.infer<typeof rangeQuery>) {
    if (!user.employeeId) throw new NotFoundException('Your account is not linked to an employee profile');
    return this.attendance.mine(user, tenant, q.from, q.to);
  }

  @Get('roster')
  @Permissions('attendance.roster.read')
  roster(@CurrentUser() user: AuthUser, @CurrentTenant() tenant: TenantSnapshot, @Query(new ZodValidationPipe(dayQuery)) q: z.infer<typeof dayQuery>) {
    return this.attendance.roster(user, tenant, q.date);
  }
}
