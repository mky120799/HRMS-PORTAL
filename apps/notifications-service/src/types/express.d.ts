declare global {
  namespace Express {
    interface Request {
      auth?: { sub: string; email: string; tenantId: string; role: string };
    }
  }
}

export {};
