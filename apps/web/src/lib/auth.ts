export interface AuthState {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresIn: string;
  user: {
    id: string;
    email: string;
    name: string;
    role: string;
    tenantId: string;
  };
}

const KEY = 'hrms_auth';

export function getAuth(): AuthState | null {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    // Auto-unwrap if it was accidentally saved as { success: true, data: { ... } }
    if (parsed && typeof parsed === 'object' && 'data' in parsed && parsed.success === true) {
      return parsed.data as AuthState;
    }
    return parsed as AuthState;
  } catch {
    return null;
  }
}

export function setAuth(auth: AuthState) {
  localStorage.setItem(KEY, JSON.stringify(auth));
}

export function clearAuth() {
  localStorage.removeItem(KEY);
}

export function hasRole(allowed: string[]) {
  const auth = getAuth();
  if (!auth) return false;
  return allowed.includes(auth.user.role);
}

// Alias used by the Google SSO callback page
export const saveAuth = setAuth;
