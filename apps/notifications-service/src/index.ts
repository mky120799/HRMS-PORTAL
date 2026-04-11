import express from 'express';
import { env } from './env';
import { internalAuth } from './middleware/internal-auth';
import { jwtAuth, AuthenticatedRequest } from './middleware/jwt-auth';
import { prisma } from './prisma';
import { internalCreateSchema, userCreateSchema, composeEmailSchema } from './schemas';
import { validateBody } from './validation';
import { sendEmail } from './mailer';

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ service: 'notifications-service', status: 'ok', runtime: 'express' });
});

// ─── INTERNAL: Create notification (from other services) ─────────────────────
app.post(
  '/internal/notifications',
  internalAuth,
  validateBody(internalCreateSchema),
  async (req, res) => {
    const { tenantId, channel, title, body, recipientUserId, recipientEmail, subject, metadata, status } = req.body;
    const row = await prisma.notification.create({
      data: {
        tenantId,
        channel,
        title,
        body,
        recipientUserId: recipientUserId ?? null,
        recipientEmail: recipientEmail ?? null,
        subject: subject ?? null,
        metadata: metadata ?? undefined,
        status: status ?? 'PENDING',
      },
    });

    // Auto-send email if channel is EMAIL and we have a recipient
    if (channel === 'EMAIL' && recipientEmail) {
      try {
        await sendEmail({ to: recipientEmail, subject: subject ?? title, text: body });
        await prisma.notification.update({ where: { id: row.id }, data: { status: 'SENT' } });
      } catch (err: any) {
        console.error('Email send failed:', err.message);
      }
    }

    res.status(201).json(row);
  },
);

// ─── USER: List notifications ─────────────────────────────────────────────────
app.get('/notifications', jwtAuth, async (req: AuthenticatedRequest, res) => {
  const tenantId = req.auth!.tenantId;
  const rows = await prisma.notification.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  res.json(rows);
});

// ─── USER: Create notification ────────────────────────────────────────────────
app.post(
  '/notifications',
  jwtAuth,
  validateBody(userCreateSchema),
  async (req: AuthenticatedRequest, res) => {
    const tenantId = req.auth!.tenantId;
    const { channel, title, body, recipientUserId, recipientEmail, subject, metadata } = req.body;

    let status = 'PENDING';

    // Auto-send if EMAIL channel and recipient provided
    if (channel === 'EMAIL' && recipientEmail) {
      try {
        await sendEmail({ to: recipientEmail, subject: subject ?? title, text: body });
        status = 'SENT';
      } catch (err: any) {
        console.error('Email send failed:', err.message);
        status = 'FAILED';
      }
    }

    const row = await prisma.notification.create({
      data: {
        tenantId,
        channel,
        title,
        body,
        recipientUserId: recipientUserId ?? null,
        recipientEmail: recipientEmail ?? null,
        subject: subject ?? null,
        metadata: metadata ?? undefined,
        status,
      },
    });
    res.status(201).json(row);
  },
);

// ─── COMPOSE EMAIL: HR can send an email directly ────────────────────────────
app.post(
  '/notifications/compose-email',
  jwtAuth,
  validateBody(composeEmailSchema),
  async (req: AuthenticatedRequest, res) => {
    if (req.auth!.role !== 'ADMIN') {
      res.status(403).json({ message: 'Only admins can send emails' });
      return;
    }

    const tenantId = req.auth!.tenantId;
    const { to, subject, body } = req.body;

    let status = 'PENDING';
    try {
      await sendEmail({ to, subject, text: body });
      status = 'SENT';
    } catch (err: any) {
      console.error('Compose email failed:', err.message);
      status = 'FAILED';
      res.status(500).json({ message: 'Failed to send email', error: err.message });
      return;
    }

    const row = await prisma.notification.create({
      data: {
        tenantId,
        channel: 'EMAIL',
        title: subject,
        body,
        recipientEmail: to,
        subject,
        status,
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
