export type Role = 'SUPER_ADMIN' | 'ADMIN' | 'MANAGER' | 'EMPLOYEE';

export interface AuthState {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresIn: number;
  user: {
    id: string;
    email: string;
    name: string;
    role: Role;
    tenantId: string;
    employeeId: string | null;
    isTwoFactorEnabled?: boolean;
  };
  tenant?: { id: string; slug: string; name: string };
}

const KEY = 'hrms_auth';
const WORKSPACE_KEY = 'hrms_last_workspace';

// Note: tokens are kept in localStorage for simplicity. The main mitigations are a
// 15-minute access token, refresh rotation with reuse detection, and a strict CSP
// (see infrastructure/nginx). Moving the refresh token to an httpOnly cookie is on
// the roadmap (docs/PRODUCTION_PLAN.md).
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
  localStorage.setItem(KEY, JSON.stringify(auth));
  if (auth.tenant?.slug) rememberWorkspace(auth.tenant.slug);
}

export function clearAuth() {
  localStorage.removeItem(KEY);
}

export function hasRole(allowed: Role[]) {
  const auth = getAuth();
  return !!auth && allowed.includes(auth.user.role);
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
