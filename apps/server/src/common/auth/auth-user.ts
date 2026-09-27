import type { Role } from '../constants/domain';

/**
 * The authenticated principal attached to `request.user` by JwtStrategy.
 * Every field is guaranteed present (employeeId may be null for users
 * without an employee profile), so services never see `undefined` tenantIds.
 */
export interface AuthUser {
  userId: string;
  tenantId: string;
  role: Role;
  email: string;
  name: string;
  employeeId: string | null;
}
