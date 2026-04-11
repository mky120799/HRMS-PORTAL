import express from 'express';
import { env } from './env';
import { prisma } from './prisma';
import { createTenantSchema } from './schemas';
import { validateBody } from './validation';

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ service: 'tenant-service', status: 'ok', runtime: 'express' });
});

app.post('/internal/tenants', validateBody(createTenantSchema), async (req, res) => {
  const secret = req.headers['x-internal-secret'];
  if (secret !== env.internalServiceSecret) {
    res.status(401).json({ message: 'Invalid internal secret' });
    return;
  }

  const { name } = req.body;
  const slug = req.body.slug || name.toLowerCase().replace(/ /g, '-').replace(/[^\w-]/g, '');
  const row = await prisma.tenant.create({ data: { name, slug } });
  res.status(201).json(row);
});

app.get('/internal/tenants/:id', async (req, res) => {
  const secret = req.headers['x-internal-secret'];
  if (secret !== env.internalServiceSecret) {
    res.status(401).json({ message: 'Invalid internal secret' });
    return;
  }

  const row = await prisma.tenant.findUnique({ where: { id: req.params.id } });
  if (!row) {
    res.status(404).json({ message: 'Tenant not found' });
    return;
  }
  res.json(row);
});

const server = app.listen(env.port, () => {
  console.log(`tenant-service (Express) listening on http://localhost:${env.port}`);
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
