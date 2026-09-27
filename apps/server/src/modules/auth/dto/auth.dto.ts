import { z } from 'zod';
import { email, password, personName } from '../../../common/validation/common.schemas';
import { TENANT_ROLES } from '../../../common/constants/domain';

/** `tenantId` accepts the workspace id or its slug (what users actually remember). */
const tenantRef = z.string().trim().min(1).max(100);

export const signupSchema = z.object({
  tenantName: z.string().trim().min(2).max(100),
  name: personName,
  email,
  password,
});
export type SignupDto = z.infer<typeof signupSchema>;

export const loginSchema = z.object({
  tenantId: tenantRef,
  email,
  password: z.string().min(1).max(128),
});
export type LoginDto = z.infer<typeof loginSchema>;

export const twoFactorLoginSchema = z.object({
  tempToken: z.string().min(1),
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
});

export const twoFactorCodeSchema = z.object({ code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code') });

export const refreshSchema = z.object({ refreshToken: z.string().min(1) });

export const inviteSchema = z.object({
  email,
  name: personName,
  role: z.enum(TENANT_ROLES).default('EMPLOYEE'),
});
export type InviteDto = z.infer<typeof inviteSchema>;

export const resetRequestSchema = z.object({ tenantId: tenantRef, email });
export type ResetRequestDto = z.infer<typeof resetRequestSchema>;

export const setPasswordSchema = z.object({ token: z.string().min(1), password });
export type SetPasswordDto = z.infer<typeof setPasswordSchema>;

export const changePasswordSchema = z.object({ currentPassword: z.string().min(1), newPassword: password });
export type ChangePasswordDto = z.infer<typeof changePasswordSchema>;

export const ssoExchangeSchema = z.object({ code: z.string().min(1) });
