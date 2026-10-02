export type Role =
  | 'SUPER_ADMIN'
  | 'ADMIN'
  | 'HR_ADMIN'
  | 'HR_MANAGER'
  | 'PAYROLL_ADMIN'
  | 'RECRUITER'
  | 'HIRING_MANAGER'
  | 'INTERVIEWER'
  | 'MANAGER'
  | 'EMPLOYEE'
  | 'AUDITOR'
  | 'FINANCE'
  | 'IT_ADMIN';

export type Permission =
  | 'platform.manage'
  | 'tenant.settings.manage'
  | 'tenant.billing.manage'
  | 'security.manage'
  | 'identity_providers.manage'
  | 'roles.manage'
  | 'audit.read'
  | 'analytics.read'
  | 'employees.read_full'
  | 'employees.manage'
  | 'employees.offboard'
  | 'employees.roles.manage'
  | 'attendance.roster.read'
  | 'leave.admin'
  | 'leave.review'
  | 'payroll.read'
  | 'payroll.salary.manage'
  | 'payroll.run.manage'
  | 'payroll.finalize'
  | 'documents.team.read'
  | 'documents.manage'
  | 'performance.team.read'
  | 'performance.manage'
  | 'performance.review'
  | 'hiring.read'
  | 'hiring.jobs.manage'
  | 'hiring.pipeline.manage'
  | 'hiring.offers.manage'
  | 'hiring.assessments.manage'
  | 'hiring.feedback.submit'
  | 'notifications.manage';

const TENANT_ADMIN_PERMISSIONS: Permission[] = [
  'tenant.settings.manage',
  'tenant.billing.manage',
  'security.manage',
  'identity_providers.manage',
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
];

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  SUPER_ADMIN: ['platform.manage'],
  ADMIN: TENANT_ADMIN_PERMISSIONS,
  HR_ADMIN: ['tenant.settings.manage', 'analytics.read', 'employees.read_full', 'employees.manage', 'employees.offboard', 'employees.roles.manage', 'attendance.roster.read', 'leave.admin', 'leave.review', 'documents.team.read', 'documents.manage', 'performance.team.read', 'performance.manage', 'performance.review', 'notifications.manage'],
  HR_MANAGER: ['analytics.read', 'employees.read_full', 'employees.manage', 'attendance.roster.read', 'leave.review', 'documents.team.read', 'performance.team.read', 'performance.review'],
  PAYROLL_ADMIN: ['analytics.read', 'employees.read_full', 'attendance.roster.read', 'payroll.read', 'payroll.salary.manage', 'payroll.run.manage', 'payroll.finalize'],
  RECRUITER: ['analytics.read', 'hiring.read', 'hiring.jobs.manage', 'hiring.pipeline.manage', 'hiring.assessments.manage', 'hiring.feedback.submit'],
  HIRING_MANAGER: ['analytics.read', 'hiring.read', 'hiring.pipeline.manage', 'hiring.offers.manage', 'hiring.feedback.submit'],
  INTERVIEWER: ['hiring.read', 'hiring.feedback.submit'],
  MANAGER: ['analytics.read', 'attendance.roster.read', 'leave.review', 'documents.team.read', 'performance.team.read', 'performance.review', 'hiring.read', 'hiring.pipeline.manage', 'hiring.feedback.submit'],
  EMPLOYEE: [],
  AUDITOR: ['audit.read', 'analytics.read', 'employees.read_full'],
  FINANCE: ['analytics.read', 'employees.read_full', 'payroll.read'],
  IT_ADMIN: ['tenant.settings.manage', 'security.manage', 'audit.read'],
};

export interface AuthState {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
  sessionId?: string;
  user: {
    id: string;
    email: string;
    name: string;
    role: Role;
    tenantId: string;
    employeeId: string | null;
    isTwoFactorEnabled?: boolean;
    /** Set when the user holds a workspace custom role. */
    customRoleId?: string | null;
    /** Effective permissions from the server (built-in role or custom role). */
    permissions?: Permission[];
  };
  tenant?: { id: string; slug: string; name: string };
}

const KEY = 'hrms_auth';
const WORKSPACE_KEY = 'hrms_last_workspace';

// Only the short-lived access token (15 min) and profile are kept in localStorage.
// The refresh token lives in an httpOnly cookie that page script cannot read, so an
// XSS bug cannot steal a long-lived credential. Revoked sessions stop working
// within ~30 s because the API checks the session id on each request.
export function getAuth(): AuthState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.accessToken ? (parsed as AuthState) : null;
  } catch {
    return null;
  }
}

export function setAuth(auth: AuthState) {
  // Older versions stored the refresh token here; never persist it again.
  const { refreshToken: _legacy, ...safe } = auth as AuthState & { refreshToken?: string };
  localStorage.setItem(KEY, JSON.stringify(safe));
  if (auth.tenant?.slug) rememberWorkspace(auth.tenant.slug);
}

export function clearAuth() {
  localStorage.removeItem(KEY);
}

export function hasRole(allowed: Role[]) {
  const auth = getAuth();
  return !!auth && allowed.includes(auth.user.role);
}

/** UI hint only; the API enforces permissions. Prefers the server's list, which covers custom roles. */
export function hasPermission(allowed: Permission[]) {
  const auth = getAuth();
  if (!auth) return false;
  const granted = auth.user.permissions ?? ROLE_PERMISSIONS[auth.user.role] ?? [];
  return allowed.some((permission) => granted.includes(permission));
}

export function rememberWorkspace(slug: string) {
  try {
    localStorage.setItem(WORKSPACE_KEY, slug);
  } catch {
    /* ignore */
  }
}

export function lastWorkspace(): string {
  try {
    return localStorage.getItem(WORKSPACE_KEY) ?? '';
  } catch {
    return '';
  }
}
