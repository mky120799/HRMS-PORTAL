import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../env';

export interface AuthenticatedRequest extends Request {
  auth?: {
    sub: string;
    email: string;
    tenantId: string;
    role: string;
  };
}

export function jwtAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const raw = req.headers.authorization ?? req.headers.Authorization;
  if (typeof raw !== 'string' || !raw.startsWith('Bearer ')) {
    res.status(401).json({ message: 'Missing bearer token' });
    return;
  }
  const token = raw.slice(7);
  try {
    const payload = jwt.verify(token, env.jwtSecret) as {
      sub: string;
      email: string;
      tenantId: string;
      role: string;
    };
    req.auth = payload;
    next();
  } catch {
    res.status(401).json({ message: 'Invalid token' });
  }
}
