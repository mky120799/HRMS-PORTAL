import type { Role } from '../constants/domain';
import type { Permission } from './permissions';

/**
 * The authenticated principal attached to `request.user` by JwtStrategy.
 * Every field is guaranteed present (employeeId may be null for users
 * without an employee profile), so services never see `undefined` tenantIds.
 */
export interface AuthUser {
  userId: string;
  tenantId: string;
  /** Built-in role; for custom-role users this is the custom role's base role. */
  role: Role;
  /** Effective permissions (built-in role map, or the assigned custom role's set). */
  permissions: readonly Permission[];
  customRoleId: string | null;
  email: string;
  name: string;
  employeeId: string | null;
  sessionId: string | null;
}
