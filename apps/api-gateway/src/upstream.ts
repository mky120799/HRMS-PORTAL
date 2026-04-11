import { isAxiosError } from 'axios';
import type { Response } from 'express';

export function sendUpstreamError(res: Response, err: unknown): void {
  if (isAxiosError(err) && err.response) {
    res.status(err.response.status).json(err.response.data);
    return;
  }
  res.status(502).json({ message: 'Upstream service error' });
}
