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
  code: z.string().trim().min(6).max(32),
});

export const twoFactorCodeSchema = z.object({ code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code') });

/** The browser sends the refresh token as an httpOnly cookie; the body field remains for non-browser clients. */
export const refreshSchema = z.object({ refreshToken: z.string().min(1).optional() });

export const mfaEnrollmentStartSchema = z.object({ enrollmentToken: z.string().min(1) });
export const mfaEnrollmentCompleteSchema = z.object({
  enrollmentToken: z.string().min(1),
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
});

/** MFA users confirm with an authenticator or recovery code; others with their password. */
export const stepUpSchema = z
  .object({
    code: z.string().trim().min(6).max(32).optional(),
    password: z.string().min(1).max(128).optional(),
  })
  .refine((value) => value.code || value.password, 'Provide an authentication code or your password');

export const inviteSchema = z
  .object({
    email,
    name: personName,
    role: z.enum(TENANT_ROLES).default('EMPLOYEE'),
    /** Invite straight into a workspace custom role instead of a built-in one. */
    customRoleId: z.string().uuid().optional(),
  })
  .refine((dto) => !dto.customRoleId || dto.role === 'EMPLOYEE', { message: 'Send either role or customRoleId', path: ['role'] });
export type InviteDto = z.infer<typeof inviteSchema>;

export const resetRequestSchema = z.object({ tenantId: tenantRef, email });
export type ResetRequestDto = z.infer<typeof resetRequestSchema>;

export const setPasswordSchema = z.object({ token: z.string().min(1), password });
export type SetPasswordDto = z.infer<typeof setPasswordSchema>;

export const changePasswordSchema = z.object({ currentPassword: z.string().min(1), newPassword: password });
export type ChangePasswordDto = z.infer<typeof changePasswordSchema>;

export const ssoExchangeSchema = z.object({ code: z.string().min(1) });
