import express from 'express';
import cors from 'cors';
import { env } from './env';
import { prisma } from './prisma';
import { jwtAuth, AuthenticatedRequest } from './middleware/jwt-auth';
import { validateBody } from './validation';
import { createJobSchema, createApplicationSchema } from './schemas';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ service: 'hiring-service', status: 'ok', runtime: 'express' });
});

// JOBS
app.get('/jobs', jwtAuth, async (req: AuthenticatedRequest, res) => {
  const tenantId = req.auth!.tenantId;
  const jobs = await prisma.job.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
  });
  res.json(jobs);
});

app.post('/jobs', jwtAuth, validateBody(createJobSchema), async (req: AuthenticatedRequest, res) => {
  if (req.auth!.role !== 'ADMIN') {
    res.status(403).json({ message: 'Only admins can create jobs' });
    return;
  }
  
  const tenantId = req.auth!.tenantId;
  const { title, description, department } = req.body;
  
  const job = await prisma.job.create({
    data: {
      tenantId,
      title,
      description,
      department,
      status: 'OPEN',
    },
  });
  
  res.status(201).json(job);
});

// APPLICATIONS
app.get('/applications', jwtAuth, async (req: AuthenticatedRequest, res) => {
  const tenantId = req.auth!.tenantId;
  const applications = await prisma.application.findMany({
    where: {
      job: { tenantId }
    },
    include: {
      job: true
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json(applications);
});

app.post('/applications', validateBody(createApplicationSchema), async (req, res) => {
  const { jobId, candidateName, candidateEmail } = req.body;
  
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job || job.status !== 'OPEN') {
    res.status(400).json({ message: 'Invalid job or job is closed' });
    return;
  }
  
  const application = await prisma.application.create({
    data: {
      jobId,
      candidateName,
      candidateEmail,
      status: 'PENDING',
    },
  });
  
  res.status(201).json(application);
});

const server = app.listen(env.port, () => {
  console.log(`hiring-service (Express) listening on http://localhost:${env.port}`);
});

process.on('SIGINT', () => {
  server.close(() => process.exit(0));
});
