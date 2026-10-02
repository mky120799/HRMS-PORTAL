import type { Role } from '../constants/domain';

export const PERMISSIONS = [
  'platform.manage',
  'tenant.settings.manage',
  'tenant.billing.manage',
  'security.manage',
  // Configure SSO/SCIM. Separate from security.manage because an identity provider
  // decides who can sign in as whom; only full workspace admins hold it.
  'identity_providers.manage',
  // Define custom roles. ADMIN only: a role definition decides what others can do.
  'roles.manage',
  'audit.read',
  'analytics.read',
  'employees.read_full',
  'employees.manage',
  'employees.offboard',
  'employees.roles.manage',
  'attendance.roster.read',
  'leave.admin',
  'leave.review',
  'payroll.read',
  'payroll.salary.manage',
  'payroll.run.manage',
  'payroll.finalize',
  'documents.team.read',
  'documents.manage',
  'performance.team.read',
  'performance.manage',
  'performance.review',
  'hiring.read',
  'hiring.jobs.manage',
  'hiring.pipeline.manage',
  'hiring.offers.manage',
  'hiring.assessments.manage',
  'hiring.feedback.submit',
  'notifications.manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const TENANT_ADMIN_PERMISSIONS = PERMISSIONS.filter(
  (permission) => permission !== 'platform.manage',
);

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  SUPER_ADMIN: ['platform.manage'],
  ADMIN: TENANT_ADMIN_PERMISSIONS,
  HR_ADMIN: [
    'tenant.settings.manage',
    'analytics.read',
    'employees.read_full',
    'employees.manage',
    'employees.offboard',
    'employees.roles.manage',
    'attendance.roster.read',
    'leave.admin',
    'leave.review',
    'documents.team.read',
    'documents.manage',
    'performance.team.read',
    'performance.manage',
    'performance.review',
    'notifications.manage',
  ],
  HR_MANAGER: [
    'analytics.read',
    'employees.read_full',
    'employees.manage',
    'attendance.roster.read',
    'leave.review',
    'documents.team.read',
    'performance.team.read',
    'performance.review',
  ],
  PAYROLL_ADMIN: [
    'analytics.read',
    'employees.read_full',
    'attendance.roster.read',
    'payroll.read',
    'payroll.salary.manage',
    'payroll.run.manage',
    'payroll.finalize',
  ],
  RECRUITER: [
    'analytics.read',
    'hiring.read',
    'hiring.jobs.manage',
    'hiring.pipeline.manage',
    'hiring.assessments.manage',
    'hiring.feedback.submit',
  ],
  HIRING_MANAGER: [
    'analytics.read',
    'hiring.read',
    'hiring.pipeline.manage',
    'hiring.offers.manage',
    'hiring.feedback.submit',
  ],
  INTERVIEWER: ['hiring.read', 'hiring.feedback.submit'],
  MANAGER: [
    'analytics.read',
    'attendance.roster.read',
    'leave.review',
    'documents.team.read',
    'performance.team.read',
    'performance.review',
    'hiring.read',
    'hiring.pipeline.manage',
    'hiring.feedback.submit',
  ],
  EMPLOYEE: [],
  AUDITOR: ['audit.read', 'analytics.read', 'employees.read_full'],
  FINANCE: ['analytics.read', 'employees.read_full', 'payroll.read'],
  IT_ADMIN: ['tenant.settings.manage', 'security.manage', 'audit.read'],
};

/**
 * Powers a custom role can never contain: platform operation, SSO/IdP
 * configuration (an IdP decides who can sign in as whom) and defining roles.
 * They stay with the built-in SUPER_ADMIN / ADMIN roles.
 */
export const NON_DELEGABLE_PERMISSIONS: readonly Permission[] = ['platform.manage', 'identity_providers.manage', 'roles.manage'];

export const DELEGABLE_PERMISSIONS: readonly Permission[] = PERMISSIONS.filter(
  (permission) => !NON_DELEGABLE_PERMISSIONS.includes(permission),
);

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}

/** Permissions of a built-in role. Prefer `can(user, …)`, which also covers custom roles. */
export function hasPermission(
  role: Role,
  permission: Permission,
): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export function hasAnyPermission(
  role: Role,
  permissions: readonly Permission[],
): boolean {
  return permissions.some((permission) => hasPermission(role, permission));
}

/** The subject of a permission check: the signed-in user (custom-role aware) or a bare role. */
export interface PermissionSubject {
  role: Role;
  /** Effective permissions resolved by JwtStrategy; absent means "use the built-in role". */
  permissions?: readonly Permission[];
}

export function permissionsOf(subject: PermissionSubject): readonly Permission[] {
  return subject.permissions ?? ROLE_PERMISSIONS[subject.role] ?? [];
}

/** Does this user hold the permission? Works for built-in and custom roles. */
export function can(subject: PermissionSubject, permission: Permission): boolean {
  return permissionsOf(subject).includes(permission);
}

export function canAny(subject: PermissionSubject, permissions: readonly Permission[]): boolean {
  return permissions.some((permission) => can(subject, permission));
}
