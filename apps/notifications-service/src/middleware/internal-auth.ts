import type { NextFunction, Request, Response } from 'express';
import { env } from '../env';

export function internalAuth(req: Request, res: Response, next: NextFunction) {
  const secret = req.headers['x-internal-secret'];
  if (typeof secret !== 'string' || secret !== env.internalServiceSecret) {
    res.status(401).json({ message: 'Invalid internal secret' });
    return;
  }
  next();
}
