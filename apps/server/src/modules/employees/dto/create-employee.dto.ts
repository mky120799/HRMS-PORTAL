import { z } from 'zod';
import { email, isoDate, paginationSchema, personName } from '../../../common/validation/common.schemas';
import { EMPLOYEE_STATUSES, EMPLOYMENT_TYPES, TENANT_ROLES } from '../../../common/constants/domain';

const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal('').transform(() => undefined));

export const createEmployeeSchema = z.object({
  email,
  firstName: personName,
  lastName: z.string().trim().max(100).default(''),
  employeeCode: optionalText(30),
  phone: z.string().trim().regex(/^\+?[0-9 ()-]{7,20}$/, 'Invalid phone number').optional().or(z.literal('').transform(() => undefined)),
  department: optionalText(100),
  designation: optionalText(100),
  managerId: z.string().uuid().nullable().optional(),
  employmentType: z.enum(EMPLOYMENT_TYPES).default('FULL_TIME'),
  dateOfJoining: isoDate.optional(),
});
export type CreateEmployeeDto = z.infer<typeof createEmployeeSchema>;

export const updateEmployeeSchema = createEmployeeSchema.omit({ email: true }).partial().extend({
  status: z.enum(['ACTIVE', 'ON_NOTICE']).optional(), // EXITED only via the offboarding endpoint
});
export type UpdateEmployeeDto = z.infer<typeof updateEmployeeSchema>;

export const listEmployeesSchema = paginationSchema.extend({
  search: z.string().trim().max(100).optional(),
  department: z.string().trim().max(100).optional(),
  status: z.enum(EMPLOYEE_STATUSES).optional(),
});
export type ListEmployeesQuery = z.infer<typeof listEmployeesSchema>;

export const offboardSchema = z.object({ exitDate: isoDate });
export const changeRoleSchema = z.object({ role: z.enum(TENANT_ROLES) });
