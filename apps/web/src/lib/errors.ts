import axios from 'axios';

/** Turns an API error ({ message, errors[] }) into one readable sentence. */
export function getErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { message?: unknown; errors?: { path: string; message: string }[] } | undefined;
    if (data?.errors?.length) return data.errors.map((e) => (e.path ? `${e.path}: ${e.message}` : e.message)).join('; ');
    if (typeof data?.message === 'string') return data.message;
    if (error.response?.status === 401) return 'Your session expired. Please sign in again.';
    if (error.response?.status === 429) return 'Too many requests. Please wait a moment and try again.';
    if (!error.response) return 'Cannot reach the server. Check your connection.';
    return `Request failed (${error.response.status})`;
  }
  if (error instanceof Error) return error.message;
  return 'Something went wrong. Please try again.';
}
