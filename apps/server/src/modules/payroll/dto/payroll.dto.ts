import { z } from 'zod';

export const updateSalarySchema = z.object({
  baseSalary: z.number().positive(),
  allowances: z.number().nonnegative(),
  deductions: z.number().nonnegative(),
});
export type UpdateSalaryDto = z.infer<typeof updateSalarySchema>;

export const generatePayslipSchema = z.object({
  month: z.number().min(1).max(12),
  year: z.number().min(2000).max(2100),
});
export type GeneratePayslipDto = z.infer<typeof generatePayslipSchema>;
