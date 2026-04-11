import axios from 'axios';

export function getErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { message?: string } | undefined;
    if (typeof data?.message === 'string') return data.message;
    if (error.response?.status === 401) return 'Your session expired. Please log in again.';
    return `Request failed (${error.response?.status ?? 'network'})`;
  }
  if (error instanceof Error) return error.message;
  return 'Something went wrong. Please try again.';
}
