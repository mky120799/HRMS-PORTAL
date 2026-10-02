import axios, { AxiosError, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { clearAuth, getAuth, setAuth } from './auth';

/** Base URL of the API, e.g. https://app.example.com/api/v1 (same-origin "/api/v1" in production). */
export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api/v1';

/** withCredentials: the refresh token is an httpOnly cookie scoped to /api/v1/auth. */
export const api = axios.create({ baseURL: API_BASE_URL, timeout: 30_000, withCredentials: true });

/** The API wraps successes as { success: true, data }. Unwrap once here so pages read `res.data` directly. */
function unwrap(res: AxiosResponse) {
  const body = res.data;
  if (body && typeof body === 'object' && !(body instanceof Blob) && body.success === true && 'data' in body) {
    res.data = body.data;
  }
  return res;
}

// ─── Step-up (re-authentication for sensitive actions) ────────────────────────
// Sensitive endpoints answer 403 { code: 'STEP_UP_REQUIRED' }. A dialog asks for
// an MFA code (or password), we get a 5-minute step-up token and retry. The
// token is kept in memory only, so it never outlives the tab.
let stepUp: { token: string; expiresAt: number } | null = null;
let stepUpPrompt: (() => Promise<string | null>) | null = null;

export function registerStepUpPrompt(prompt: (() => Promise<string | null>) | null) {
  stepUpPrompt = prompt;
}

export function rememberStepUp(token: string, expiresInSeconds: number) {
  stepUp = { token, expiresAt: Date.now() + (expiresInSeconds - 10) * 1000 };
}

api.interceptors.request.use((config) => {
  const auth = getAuth();
  if (auth?.accessToken) config.headers.Authorization = `Bearer ${auth.accessToken}`;
  if (stepUp && stepUp.expiresAt > Date.now()) config.headers['x-step-up-token'] = stepUp.token;
  return config;
});

// ─── Transparent token refresh ─────────────────────────────────────────────────
// Access tokens live 15 minutes. On a 401 we refresh once and replay the request.
// Tabs share one refresh cookie, so refreshes are serialized across tabs with a
// Web Lock; a tab that waited re-reads storage and reuses the token another tab
// just obtained instead of presenting an already-rotated refresh token (which the
// server would treat as token theft and revoke the session).
let refreshInFlight: Promise<string> | null = null;

async function refreshAccessToken(failedAccessToken: string | undefined): Promise<string> {
  const run = async () => {
    const auth = getAuth();
    if (!auth) throw new Error('Not signed in');
    if (failedAccessToken && auth.accessToken !== failedAccessToken) return auth.accessToken;
    const res = await axios.post(`${API_BASE_URL}/auth/refresh`, {}, { withCredentials: true });
    const session = res.data?.data ?? res.data;
    setAuth({ ...auth, ...session });
    return session.accessToken as string;
  };
  return typeof navigator !== 'undefined' && navigator.locks ? navigator.locks.request('hrms-auth-refresh', run) : run();
}

function goToLogin() {
  clearAuth();
  stepUp = null;
  if (!['/login', '/signup'].includes(window.location.pathname)) window.location.href = '/login';
}

const AUTH_CALLS = ['/auth/login', '/auth/refresh', '/auth/2fa/authenticate', '/auth/2fa/enroll', '/auth/sso/exchange', '/auth/step-up', '/auth/signup'];

api.interceptors.response.use(unwrap, async (error: AxiosError<{ code?: string }>) => {
  const original = error.config as (InternalAxiosRequestConfig & { _retry?: boolean; _stepUp?: boolean }) | undefined;
  const isAuthCall = AUTH_CALLS.some((path) => original?.url?.startsWith(path));

  if (error.response?.status === 403 && error.response.data?.code === 'STEP_UP_REQUIRED' && original && !original._stepUp && stepUpPrompt) {
    original._stepUp = true;
    const token = await stepUpPrompt();
    if (token) {
      original.headers['x-step-up-token'] = token;
      return api(original);
    }
    return Promise.reject(error);
  }

  if (error.response?.status === 401 && original && !original._retry && !isAuthCall && getAuth()) {
    original._retry = true;
    try {
      const failed = String(original.headers.Authorization ?? '').replace(/^Bearer\s+/, '') || undefined;
      refreshInFlight ??= refreshAccessToken(failed).finally(() => (refreshInFlight = null));
      const token = await refreshInFlight;
      original.headers.Authorization = `Bearer ${token}`;
      return api(original);
    } catch {
      goToLogin();
    }
  } else if (error.response?.status === 401 && !isAuthCall && getAuth()) {
    goToLogin();
  }
  return Promise.reject(error);
});

/** Downloads a protected file (payslip PDF, document, resume, data export) with the user's token. */
export async function downloadFile(url: string, fallbackName: string) {
  const res = await api.get(url, { responseType: 'blob' });
  const disposition = String(res.headers['content-disposition'] ?? '');
  const name = /filename="?([^";]+)"?/.exec(disposition)?.[1] ?? fallbackName;
  const href = URL.createObjectURL(res.data as Blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  a.click();
  URL.revokeObjectURL(href);
}

/** Shape of paginated list responses. */
export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
