import { z } from 'zod';

/** Mirrors the server policy (apps/server/src/common/validation/common.schemas.ts). */
export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(128)
  .regex(/[A-Za-z]/, 'Include at least one letter')
  .regex(/[0-9]/, 'Include at least one number');
