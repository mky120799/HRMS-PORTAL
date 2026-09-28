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
});

export const holidaySchema = z.object({ date: isoDate, name: z.string().trim().min(1).max(100) });
