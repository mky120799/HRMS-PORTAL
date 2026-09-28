import axios, { AxiosError, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { clearAuth, getAuth, setAuth } from './auth';

/** Base URL of the API, e.g. https://app.example.com/api/v1 (same-origin "/api/v1" in production). */
export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api/v1';

export const api = axios.create({ baseURL: API_BASE_URL, timeout: 30_000 });

/** The API wraps successes as { success: true, data }. Unwrap once here so pages read `res.data` directly. */
function unwrap(res: AxiosResponse) {
  const body = res.data;
  if (body && typeof body === 'object' && !(body instanceof Blob) && body.success === true && 'data' in body) {
    res.data = body.data;
  }
  return res;
}

api.interceptors.request.use((config) => {
  const auth = getAuth();
  if (auth?.accessToken) config.headers.Authorization = `Bearer ${auth.accessToken}`;
  return config;
});

// ─── Transparent token refresh ─────────────────────────────────────────────────
// Access tokens live 15 minutes. On a 401 we refresh once (concurrent requests
// wait for the same refresh) and replay the original request.
let refreshInFlight: Promise<string> | null = null;

async function refreshAccessToken(): Promise<string> {
  const auth = getAuth();
  if (!auth?.refreshToken) throw new Error('No refresh token');
  const res = await axios.post(`${API_BASE_URL}/auth/refresh`, { refreshToken: auth.refreshToken });
  const session = res.data?.data ?? res.data;
  setAuth({ ...auth, ...session });
  return session.accessToken as string;
}

function goToLogin() {
  clearAuth();
  if (!['/login', '/signup'].includes(window.location.pathname)) window.location.href = '/login';
}

api.interceptors.response.use(unwrap, async (error: AxiosError) => {
  const original = error.config as (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined;
  const isAuthCall = original?.url?.startsWith('/auth/login') || original?.url?.startsWith('/auth/refresh');
  if (error.response?.status === 401 && original && !original._retry && !isAuthCall && getAuth()?.refreshToken) {
    original._retry = true;
    try {
      refreshInFlight ??= refreshAccessToken().finally(() => (refreshInFlight = null));
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
