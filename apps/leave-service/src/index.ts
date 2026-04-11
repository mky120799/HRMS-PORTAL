import express from 'express';
import { env } from './env';
import { connectDb, LeaveRequest } from './models';
import { jwtAuth, AuthenticatedRequest } from './middleware/jwt-auth';
import { createLeaveRequestSchema } from './schemas';
import { validateBody } from './validation';

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ service: 'leave-service', status: 'ok', runtime: 'express' });
});

app.get('/leave-requests', jwtAuth, async (req: AuthenticatedRequest, res) => {
  const tenantId = req.auth!.tenantId;
  const rows = await LeaveRequest.find({ tenantId }).sort({ createdAt: -1 }).lean().exec();
  res.json(rows);
});

app.post('/leave-requests', jwtAuth, validateBody(createLeaveRequestSchema), async (req: AuthenticatedRequest, res) => {
  const tenantId = req.auth!.tenantId;
  const { employeeId, startDate, endDate, type, reason } = req.body;

  const doc = new LeaveRequest({
    tenantId,
    employeeId,
    startDate: new Date(startDate),
    endDate: new Date(endDate),
    type: type ?? 'ANNUAL',
    status: 'PENDING',
    reason,
  });

  await doc.save();
  res.status(201).json(doc);
});

app.get('/leave-requests/:id', jwtAuth, async (req: AuthenticatedRequest, res) => {
  const tenantId = req.auth!.tenantId;
  const row = await LeaveRequest.findOne({ _id: req.params.id, tenantId }).lean().exec();
  if (!row) {
    res.status(404).json({ message: 'Leave request not found' });
    return;
  }
  res.json(row);
});

async function run() {
  await connectDb(env.mongoUri);
  console.log('leave-service connected to MongoDB');
  const server = app.listen(env.port, () => {
    console.log(`leave-service (Express) listening on http://localhost:${env.port}`);
  });

  process.on('SIGINT', () => {
    server.close(() => process.exit(0));
  });
}

run().catch(console.error);
