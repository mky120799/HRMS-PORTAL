import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { LeavesService } from './leaves.service';
import { CurrentUser, Permissions } from '../../common/auth/decorators';
import type { AuthUser } from '../../common/auth/auth-user';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  createLeaveRequestSchema,
  adjustLeaveBalanceSchema,
  approvalDelegationSchema,
  accrualRunSchema,
  carryForwardSchema,
  holidaySchema,
  leaveLedgerQuerySchema,
  replaceApprovalRulesSchema,
  listLeavesSchema,
  reviewLeaveSchema,
  upsertPolicySchema,
  type CreateLeaveRequestDto,
  type AdjustLeaveBalanceDto,
  type ApprovalDelegationDto,
  type ListLeavesQuery,
  type LeaveLedgerQuery,
  type ReviewLeaveDto,
  type ReplaceApprovalRulesDto,
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

  @Get('leave-balance-ledger')
  ledger(@CurrentUser() user: AuthUser, @Query(new ZodValidationPipe(leaveLedgerQuerySchema)) q: LeaveLedgerQuery) {
    return this.leaves.ledger(user, q);
  }

  @Post('leave-requests')
  create(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(createLeaveRequestSchema)) dto: CreateLeaveRequestDto) {
    return this.leaves.create(user, dto);
  }

  @Patch('leave-requests/:id/status')
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
  @Permissions('leave.admin')
  upsertPolicy(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(upsertPolicySchema)) dto: z.infer<typeof upsertPolicySchema>) {
    return this.leaves.upsertPolicy(user.tenantId, dto);
  }

  @Get('leave-policies/:type/versions')
  @Permissions('leave.admin')
  policyVersions(@CurrentUser() user: AuthUser, @Param('type') type: string) {
    return this.leaves.listPolicyVersions(user.tenantId, type.trim().toUpperCase());
  }

  @Get('holidays')
  holidays(@CurrentUser() user: AuthUser, @Query(new ZodValidationPipe(yearQuery)) q: z.infer<typeof yearQuery>) {
    return this.leaves.listHolidays(user.tenantId, q.year);
  }

  @Post('holidays')
  @Permissions('leave.admin')
  addHoliday(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(holidaySchema)) dto: z.infer<typeof holidaySchema>) {
    return this.leaves.addHoliday(user.tenantId, dto);
  }

  @Delete('holidays/:id')
  @Permissions('leave.admin')
  removeHoliday(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.leaves.removeHoliday(user.tenantId, id);
  }

  /** Intended for a protected scheduler or an admin-operated recovery run. */
  @Post('leave-accruals/run')
  @Permissions('leave.admin')
  accrue(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(accrualRunSchema)) dto: { year: number; month: number }) {
    return this.leaves.accrueMonthly(user.tenantId, dto.year, dto.month);
  }

  @Post('leave-carry-forward/run')
  @Permissions('leave.admin')
  carryForward(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(carryForwardSchema)) dto: { year: number }) {
    return this.leaves.carryForward(user.tenantId, dto.year);
  }

  @Post('leave-balance-adjustments')
  @Permissions('leave.admin')
  adjustBalance(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(adjustLeaveBalanceSchema)) dto: AdjustLeaveBalanceDto) {
    return this.leaves.adjustBalance(user, dto);
  }

  @Get('leave-approval-rules')
  @Permissions('leave.admin')
  approvalRules(@CurrentUser() user: AuthUser) {
    return this.leaves.listApprovalRules(user.tenantId);
  }

  @Put('leave-approval-rules')
  @Permissions('leave.admin')
  replaceApprovalRules(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(replaceApprovalRulesSchema)) dto: ReplaceApprovalRulesDto) {
    return this.leaves.replaceApprovalRules(user.tenantId, dto);
  }

  @Get('leave-approval-delegations')
  approvalDelegations(@CurrentUser() user: AuthUser) {
    return this.leaves.listApprovalDelegations(user);
  }

  @Post('leave-approval-delegations')
  createApprovalDelegation(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(approvalDelegationSchema)) dto: ApprovalDelegationDto) {
    return this.leaves.createApprovalDelegation(user, dto);
  }
}
