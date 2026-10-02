import { z } from 'zod';
import { DELEGABLE_PERMISSIONS } from '../../common/auth/permissions';
import { TENANT_ROLES } from '../../common/constants/domain';

/** Base roles a custom role can build on. ADMIN is excluded: full administration stays built-in. */
export const CUSTOM_ROLE_BASES = TENANT_ROLES.filter((role) => role !== 'ADMIN');

const permissions = z
  .array(z.enum(DELEGABLE_PERMISSIONS as unknown as [string, ...string[]]))
  .max(DELEGABLE_PERMISSIONS.length)
  .transform((list) => [...new Set(list)]);

export const createCustomRoleSchema = z.object({
  key: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z0-9_]{1,39}$/, 'Use 2–40 letters, digits or underscores, starting with a letter (e.g. REGIONAL_HR)')
    .refine((key) => !(TENANT_ROLES as readonly string[]).includes(key) && key !== 'SUPER_ADMIN', 'This key is a built-in role'),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(300).optional(),
  baseRole: z.enum(CUSTOM_ROLE_BASES as unknown as [string, ...string[]]),
  permissions,
});
export type CreateCustomRoleDto = z.infer<typeof createCustomRoleSchema>;

/** The key is permanent because IdP role mappings refer to it ("custom:<KEY>"). */
export const updateCustomRoleSchema = createCustomRoleSchema.omit({ key: true }).partial().extend({ isActive: z.boolean().optional() });
export type UpdateCustomRoleDto = z.infer<typeof updateCustomRoleSchema>;
