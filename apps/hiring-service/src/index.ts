import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { env } from './env';
import { prisma } from './prisma';
import { jwtAuth, AuthenticatedRequest } from './middleware/jwt-auth';
import { validateBody } from './validation';
import { createJobSchema } from './schemas';
import { z } from 'zod';

const app = express();
app.use(cors());
app.use(express.json());

// ─── File Upload Setup (Multer) ───────────────────────────────────────────────
const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}${path.extname(file.originalname)}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['.pdf', '.doc', '.docx', '.jpg', '.jpeg', '.png'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error(`Invalid file type. Allowed: ${allowed.join(', ')}`));
  },
});

// Serve uploaded files statically
app.use('/uploads', express.static(uploadsDir));

// ─── Health ───────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ service: 'hiring-service', status: 'ok', runtime: 'express' });
});

// ─── JOBS ─────────────────────────────────────────────────────────────────────
app.get('/jobs', jwtAuth, async (req: AuthenticatedRequest, res) => {
  const tenantId = req.auth!.tenantId;
  const jobs = await prisma.job.findMany({
    where: { tenantId },
    include: { _count: { select: { applications: true } } },
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
  const job = await prisma.job.create({ data: { tenantId, title, description, department, status: 'OPEN' } });
  res.status(201).json(job);
});

app.patch('/jobs/:id', jwtAuth, async (req: AuthenticatedRequest, res) => {
  if (req.auth!.role !== 'ADMIN') { res.status(403).json({ message: 'Admin only' }); return; }
  const tenantId = req.auth!.tenantId;
  const { status } = req.body;
  const job = await prisma.job.updateMany({ where: { id: req.params.id, tenantId }, data: { status } });
  res.json(job);
});

// ─── APPLICATIONS ─────────────────────────────────────────────────────────────
app.get('/applications', jwtAuth, async (req: AuthenticatedRequest, res) => {
  const tenantId = req.auth!.tenantId;
  const { jobId } = req.query;

  const applications = await prisma.application.findMany({
    where: { job: { tenantId }, ...(jobId ? { jobId: jobId as string } : {}) },
    include: { job: { select: { id: true, title: true, department: true } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json(applications);
});

// POST /applications — accepts multipart/form-data (with optional resume file)
app.post('/applications', upload.single('resume'), async (req, res) => {
  const schema = z.object({
    jobId: z.string().uuid(),
    candidateName: z.string().min(1),
    candidateEmail: z.string().email(),
  });

  const parse = schema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ message: 'Validation failed', errors: parse.error.errors });
    return;
  }

  const { jobId, candidateName, candidateEmail } = parse.data;

  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job || job.status !== 'OPEN') {
    res.status(400).json({ message: 'Invalid job or job is closed' });
    return;
  }

  const resumeFile = req.file;
  const application = await prisma.application.create({
    data: {
      jobId,
      candidateName,
      candidateEmail,
      status: 'PENDING',
      resumeFilename: resumeFile?.originalname ?? null,
      resumeUrl: resumeFile ? `/uploads/${resumeFile.filename}` : null,
    },
  });

  res.status(201).json(application);
});

// Update application status (e.g. INTERVIEW, HIRED, REJECTED)
app.patch('/applications/:id', jwtAuth, async (req: AuthenticatedRequest, res) => {
  if (req.auth!.role !== 'ADMIN') { res.status(403).json({ message: 'Admin only' }); return; }
  const { status } = req.body;
  const app_ = await prisma.application.update({ where: { id: req.params.id }, data: { status } });
  res.json(app_);
});

const server = app.listen(env.port, () => {
  console.log(`hiring-service (Express) listening on http://localhost:${env.port}`);
});

process.on('SIGINT', () => { server.close(() => process.exit(0)); });
