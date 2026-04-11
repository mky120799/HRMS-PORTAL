import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';

export function validateBody(schema: z.ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({ message: 'Validation failed', errors: result.error.errors });
      return;
    }
    req.body = result.data;
    next();
  };
}
