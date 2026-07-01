import axios from 'axios';
import { getAuth, setAuth, clearAuth } from './auth';

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api/v1',
  timeout: 30_000,
});

api.interceptors.request.use((config) => {
  const auth = getAuth();
  if (auth?.accessToken) {
    config.headers.Authorization = `Bearer ${auth.accessToken}`;
  }
  return config;
});

let refreshing = false;
let refreshQueue: Array<(token: string) => void> = [];

api.interceptors.response.use(
  (r) => r,
  async (err) => {
    const original = err.config;
    if (err?.response?.status === 401 && !original._retry) {
      const auth = getAuth();
      if (auth?.refreshToken) {
        if (refreshing) {
          return new Promise((resolve) => {
            refreshQueue.push((token) => {
              original.headers.Authorization = `Bearer ${token}`;
              resolve(api(original));
            });
          });
        }
        original._retry = true;
        refreshing = true;
        try {
          const res = await axios.post(
            `${import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api/v1'}/auth/refresh`,
            { refreshToken: auth.refreshToken }
          );
          const { accessToken, refreshToken } = res.data.data ?? res.data;
          setAuth({ ...auth, accessToken, refreshToken });
          refreshQueue.forEach((cb) => cb(accessToken));
          refreshQueue = [];
          original.headers.Authorization = `Bearer ${accessToken}`;
          return api(original);
        } catch {
          clearAuth();
          if (window.location.pathname !== '/login') window.location.href = '/login';
          return Promise.reject(err);
        } finally {
          refreshing = false;
        }
      }
      clearAuth();
      if (window.location.pathname !== '/login') window.location.href = '/login';
    }
    return Promise.reject(err);
  },
);
