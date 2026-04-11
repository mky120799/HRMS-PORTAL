import { isAxiosError } from 'axios';
import type { Response } from 'express';

export function sendUpstreamError(res: Response, err: unknown): void {
  if (isAxiosError(err)) {
    if (err.response) {
      console.error(`Upstream ERROR [${err.config?.method?.toUpperCase()}] ${err.config?.url}: ${err.response.status} ${JSON.stringify(err.response.data)}`);
      res.status(err.response.status).json(err.response.data);
      return;
    }
    console.error(`Upstream UNREACHABLE [${err.config?.method?.toUpperCase()}] ${err.config?.url}: ${err.message}`);
  }
  res.status(502).json({ message: 'Upstream service error' });
}
