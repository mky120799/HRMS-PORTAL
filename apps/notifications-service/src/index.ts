import express from 'express';
import { env } from './env';
import { internalAuth } from './middleware/internal-auth';
import { jwtAuth } from './middleware/jwt-auth';
import { prisma } from './prisma';
import { internalCreateSchema, userCreateSchema } from './schemas';
import { validateBody } from './validation';

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ service: 'notifications-service', status: 'ok', runtime: 'express' });
});

app.post(
  '/internal/notifications',
  internalAuth,
  validateBody(internalCreateSchema),
  async (req, res) => {
    const { tenantId, channel, title, body, recipientUserId, metadata, status } = req.body;
    const row = await prisma.notification.create({
      data: {
        tenantId,
        channel,
        title,
        body,
        recipientUserId: recipientUserId ?? null,
        metadata: metadata ?? undefined,
        status: status ?? 'PENDING',
      },
    });
    res.status(201).json(row);
  },
);

app.get('/notifications', jwtAuth, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const rows = await prisma.notification.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  res.json(rows);
});

app.post(
  '/notifications',
  jwtAuth,
  validateBody(userCreateSchema),
  async (req, res) => {
    const tenantId = req.auth!.tenantId;
    const { channel, title, body, recipientUserId, metadata } = req.body;
    const row = await prisma.notification.create({
      data: {
        tenantId,
        channel,
        title,
        body,
        recipientUserId: recipientUserId ?? null,
        metadata: metadata ?? undefined,
        status: 'PENDING',
      },
    });
    res.status(201).json(row);
  },
);

const server = app.listen(env.port, () => {
  console.log(`notifications-service (Express) on http://localhost:${env.port}`);
});

async function shutdown() {
  await prisma.$disconnect();
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
