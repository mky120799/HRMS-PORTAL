import { z } from 'zod';
import { isoDate, paginationSchema } from '../../../common/validation/common.schemas';
import { LEAVE_STATUSES } from '../../../common/constants/domain';

const leaveType = z.string().trim().toUpperCase().regex(/^[A-Z_]{2,30}$/, 'Invalid leave type');

export const createLeaveRequestSchema = z
  .object({
    type: leaveType,
    startDate: isoDate,
    endDate: isoDate,
    reason: z.string().trim().max(500).optional(),
    employeeId: z.string().uuid().optional(), // admins may file on behalf of an employee
    requestKey: z.string().uuid().optional(), // retries with the same key return the original request
  })
  .refine((v) => v.endDate >= v.startDate, { message: 'End date must be on or after start date', path: ['endDate'] });
export type CreateLeaveRequestDto = z.infer<typeof createLeaveRequestSchema>;

export const reviewLeaveSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED']),
  note: z.string().trim().max(500).optional(),
});
export type ReviewLeaveDto = z.infer<typeof reviewLeaveSchema>;

export const listLeavesSchema = paginationSchema.extend({
  scope: z.enum(['mine', 'team', 'all']).default('mine'),
  status: z.enum(LEAVE_STATUSES).optional(),
});
export type ListLeavesQuery = z.infer<typeof listLeavesSchema>;

export const upsertPolicySchema = z.object({
  type: leaveType,
  annualQuota: z.number().int().min(0).max(365),
  isPaid: z.boolean().default(true),
  accrualMode: z.enum(['ANNUAL_GRANT', 'MONTHLY', 'PER_PAY_PERIOD']).default('ANNUAL_GRANT'),
  carryForwardLimit: z.number().min(0).max(365).optional().nullable(),
  allowNegative: z.boolean().default(false),
  effectiveFrom: isoDate.optional(),
  effectiveTo: isoDate.optional(),
}).refine((policy) => !policy.effectiveTo || !policy.effectiveFrom || policy.effectiveTo >= policy.effectiveFrom, {
  message: 'effectiveTo must be on or after effectiveFrom',
  path: ['effectiveTo'],
});

export const holidaySchema = z.object({ date: isoDate, name: z.string().trim().min(1).max(100) });

export const accrualRunSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
});

export const carryForwardSchema = z.object({ year: z.coerce.number().int().min(2000).max(2100) });

export const adjustLeaveBalanceSchema = z.object({
  employeeId: z.string().uuid(),
  type: leaveType,
  year: z.coerce.number().int().min(2000).max(2100),
  days: z.number().finite().min(-365).max(365).refine((value) => value !== 0 && Number.isInteger(value * 100), 'days must be non-zero and have at most two decimal places'),
  reason: z.string().trim().min(3).max(500),
  adjustmentKey: z.string().uuid().optional(),
});
export type AdjustLeaveBalanceDto = z.infer<typeof adjustLeaveBalanceSchema>;

const approvalRule = z.object({
  step: z.number().int().min(1).max(10),
  approverKind: z.enum(['DIRECT_MANAGER', 'ROLE', 'SPECIFIC_USER']),
  approverRole: z.enum(['ADMIN', 'MANAGER', 'EMPLOYEE']).optional(),
  approverUserId: z.string().uuid().optional(),
  reminderAfterHours: z.number().int().min(1).max(24 * 30).default(24),
  escalationAfterHours: z.number().int().min(1).max(24 * 90).optional(),
}).superRefine((rule, ctx) => {
  if (rule.approverKind === 'ROLE' && !rule.approverRole) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'approverRole is required for ROLE rules', path: ['approverRole'] });
  if (rule.approverKind === 'SPECIFIC_USER' && !rule.approverUserId) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'approverUserId is required for SPECIFIC_USER rules', path: ['approverUserId'] });
  if (rule.escalationAfterHours && rule.escalationAfterHours <= rule.reminderAfterHours) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'escalationAfterHours must be later than reminderAfterHours', path: ['escalationAfterHours'] });
});

export const replaceApprovalRulesSchema = z.object({
  type: leaveType,
  rules: z.array(approvalRule).min(1).max(10),
}).superRefine((value, ctx) => {
  const ordered = [...value.rules].sort((a, b) => a.step - b.step);
  if (new Set(ordered.map((rule) => rule.step)).size !== ordered.length || ordered.some((rule, index) => rule.step !== index + 1)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Approval steps must be unique and sequential from 1', path: ['rules'] });
  }
});
export type ReplaceApprovalRulesDto = z.infer<typeof replaceApprovalRulesSchema>;

export const leaveLedgerQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).default(new Date().getUTCFullYear()),
  employeeId: z.string().uuid().optional(),
  type: leaveType.optional(),
});
export type LeaveLedgerQuery = z.infer<typeof leaveLedgerQuerySchema>;

export const approvalDelegationSchema = z.object({
  delegateUserId: z.string().uuid(),
  startsAt: isoDate,
  endsAt: isoDate.optional(),
}).refine((value) => !value.endsAt || value.endsAt >= value.startsAt, { message: 'endsAt must be on or after startsAt', path: ['endsAt'] });
export type ApprovalDelegationDto = z.infer<typeof approvalDelegationSchema>;
