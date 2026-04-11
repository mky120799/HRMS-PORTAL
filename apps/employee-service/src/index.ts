import express from 'express';
import { env } from './env';
import { jwtAuth, AuthenticatedRequest } from './middleware/jwt-auth';
import { prisma } from './prisma';
import { createEmployeeSchema } from './schemas';
import { validateBody } from './validation';

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ service: 'employee-service', status: 'ok', runtime: 'express' });
});

app.get('/employees', jwtAuth, async (req: AuthenticatedRequest, res) => {
  const tenantId = req.auth!.tenantId;
  const rows = await prisma.employee.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
  });
  res.json(rows);
});

app.post('/employees', jwtAuth, validateBody(createEmployeeSchema), async (req: AuthenticatedRequest, res) => {
  const tenantId = req.auth!.tenantId;
  const { email, firstName, lastName, department, userId } = req.body;

  try {
    const row = await prisma.employee.create({
      data: {
        tenantId,
        email,
        firstName,
        lastName,
        department,
        userId,
      },
    });
    res.status(201).json(row);
  } catch (e: any) {
    if (e.code === 'P2002') {
      res.status(409).json({ message: 'Employee with this email already exists' });
      return;
    }
    throw e;
  }
});

app.get('/employees/:id', jwtAuth, async (req: AuthenticatedRequest, res) => {
  const tenantId = req.auth!.tenantId;
  const row = await prisma.employee.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!row) {
    res.status(404).json({ message: 'Employee not found' });
    return;
  }
  res.json(row);
});

const server = app.listen(env.port, () => {
  console.log(`employee-service (Express) listening on http://localhost:${env.port}`);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection at:', reason);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('SIGINT', () => {
  server.close(() => process.exit(0));
});
