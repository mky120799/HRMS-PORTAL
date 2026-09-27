import { z } from 'zod';

export const uuid = z.string().uuid();
export const email = z.string().trim().toLowerCase().email().max(254);
export const personName = z.string().trim().min(1).max(100);

/** Minimum 10 chars with at least one letter and one digit (NIST 800-63B favours length over complexity). */
export const password = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128)
  .regex(/[A-Za-z]/, 'Password must contain a letter')
  .regex(/[0-9]/, 'Password must contain a number');

/** YYYY-MM-DD */
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type Pagination = z.infer<typeof paginationSchema>;

export function paginate(p: Pagination) {
  return { skip: (p.page - 1) * p.pageSize, take: p.pageSize };
}

export function paged<T>(items: T[], total: number, p: Pagination) {
  return { items, total, page: p.page, pageSize: p.pageSize, totalPages: Math.ceil(total / p.pageSize) };
}
