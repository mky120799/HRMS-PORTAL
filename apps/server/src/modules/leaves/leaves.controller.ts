import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { LeavesService } from './leaves.service';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import type { AuthUser } from '../../common/auth/auth-user';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  createLeaveRequestSchema,
  holidaySchema,
  listLeavesSchema,
  reviewLeaveSchema,
  upsertPolicySchema,
  type CreateLeaveRequestDto,
  type ListLeavesQuery,
  type ReviewLeaveDto,
} from './dto/create-leave.dto';

const yearQuery = z.object({
  year: z.coerce.number().int().min(2000).max(2100).default(new Date().getUTCFullYear()),
  employeeId: z.string().uuid().optional(),
});

@ApiTags('Leave')
@ApiBearerAuth()
@Controller()
export class LeavesController {
  constructor(private readonly leaves: LeavesService) {}

  @Get('leave-requests')
  list(@CurrentUser() user: AuthUser, @Query(new ZodValidationPipe(listLeavesSchema)) q: ListLeavesQuery) {
    return this.leaves.list(user, q);
  }

  @Get('leave-requests/balance')
  balance(@CurrentUser() user: AuthUser, @Query(new ZodValidationPipe(yearQuery)) q: z.infer<typeof yearQuery>) {
    return this.leaves.balance(user, q.employeeId, q.year);
  }

  @Post('leave-requests')
  create(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(createLeaveRequestSchema)) dto: CreateLeaveRequestDto) {
    return this.leaves.create(user, dto);
  }

  @Patch('leave-requests/:id/status')
  @Roles('ADMIN', 'MANAGER')
  review(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(reviewLeaveSchema)) dto: ReviewLeaveDto) {
    return this.leaves.review(user, id, dto);
  }

  @Post('leave-requests/:id/cancel')
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.leaves.cancel(user, id);
  }

  @Get('leave-policies')
  policies(@CurrentUser() user: AuthUser) {
    return this.leaves.listPolicies(user.tenantId);
  }

  @Put('leave-policies')
  @Roles('ADMIN')
  upsertPolicy(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(upsertPolicySchema)) dto: z.infer<typeof upsertPolicySchema>) {
    return this.leaves.upsertPolicy(user.tenantId, dto);
  }

  @Get('holidays')
  holidays(@CurrentUser() user: AuthUser, @Query(new ZodValidationPipe(yearQuery)) q: z.infer<typeof yearQuery>) {
    return this.leaves.listHolidays(user.tenantId, q.year);
  }

  @Post('holidays')
  @Roles('ADMIN')
  addHoliday(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(holidaySchema)) dto: z.infer<typeof holidaySchema>) {
    return this.leaves.addHoliday(user.tenantId, dto);
  }

  @Delete('holidays/:id')
  @Roles('ADMIN')
  removeHoliday(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.leaves.removeHoliday(user.tenantId, id);
  }
}
