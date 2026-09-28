import { z } from 'zod';

const money = z.number().nonnegative().max(100_000_000).multipleOf(0.01);

export const upsertSalarySchema = z.object({
  baseSalary: money.positive(),
  allowances: money.default(0),
  deductions: money.default(0),
  monthlyTds: money.default(0),
  pfEnabled: z.boolean().default(true),
});
export type UpsertSalaryDto = z.infer<typeof upsertSalarySchema>;

export const periodSchema = z.object({
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(2000).max(2100),
});
export type PeriodDto = z.infer<typeof periodSchema>;
