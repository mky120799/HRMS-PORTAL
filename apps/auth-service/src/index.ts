import bcrypt from 'bcryptjs';
import express from 'express';
import jwt from 'jsonwebtoken';
import type { JwtPayload } from '@hrms/shared';
import { env } from './env';
import { prisma } from './prisma';
import { loginSchema, registerInternalSchema } from './schemas';
import { validateBody } from './validation';
import { jwtAuth, AuthenticatedRequest } from './middleware/jwt-auth';

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ service: 'auth-service', status: 'ok', runtime: 'express' });
});

app.post('/auth/login', validateBody(loginSchema), async (req, res) => {
  const { tenantId, email, password } = req.body;

  const user = await prisma.user.findUnique({
    where: { tenantId_email: { tenantId, email } },
  });

  if (!user) {
    res.status(401).json({ message: 'Invalid credentials' });
    return;
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    res.status(401).json({ message: 'Invalid credentials' });
    return;
  }

  const payload: JwtPayload = {
    sub: user.id,
    email: user.email,
    tenantId: user.tenantId,
    role: user.role,
  };

  const accessToken = jwt.sign(payload, env.jwtSecret, { expiresIn: env.jwtExpiresIn });

  res.json({
    accessToken,
    tokenType: 'Bearer',
    expiresIn: env.jwtExpiresIn,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      tenantId: user.tenantId,
    },
  });
});

app.post('/internal/register', validateBody(registerInternalSchema), async (req, res) => {
  const secret = req.headers['x-internal-secret'];
  if (secret !== env.internalServiceSecret) {
    res.status(401).json({ message: 'Invalid internal secret' });
    return;
  }

  const { tenantId, email, password, name } = req.body;

  const existing = await prisma.user.findUnique({
    where: { tenantId_email: { tenantId, email } },
  });

  if (existing) {
    res.status(409).json({ message: 'User already exists for this tenant' });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: {
      tenantId,
      email,
      passwordHash,
      name,
      role: 'ADMIN',
    },
  });

  res.status(201).json({
    id: user.id,
    tenantId: user.tenantId,
    email: user.email,
    name: user.name,
    role: user.role,
  });
});

app.get('/auth/me', jwtAuth, async (req: AuthenticatedRequest, res) => {
  const userId = req.auth!.sub;
  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user) {
    res.status(404).json({ message: 'User not found' });
    return;
  }

  res.json({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    tenantId: user.tenantId,
  });
});

const server = app.listen(env.port, () => {
  console.log(`auth-service (Express) listening on http://localhost:${env.port}`);
});

process.on('SIGINT', () => {
  server.close(() => process.exit(0));
});
