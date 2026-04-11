import cors from 'cors';
import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { env } from './env';
import { v1Router } from './routes/v1';

const app = express();
app.use(cors({ origin: ['http://localhost:5173'], credentials: true }));

// ── Proxy raw multipart POSTs to hiring-service (bypasses JSON parser) ────────
// Must be registered BEFORE express.json() middleware
app.post(
  '/api/v1/hiring/applications',
  createProxyMiddleware({
    target: env.hiringServiceUrl,
    changeOrigin: true,
    pathRewrite: { '^/api/v1/hiring/applications': '/applications' },
    on: {
      proxyReq: (proxyReq: any, req: any) => {
        if (req.headers.authorization) {
          proxyReq.setHeader('Authorization', req.headers.authorization);
        }
      },
    },
  } as any),
);

// ── Proxy GET of uploaded files (resumes) ─────────────────────────────────────
app.use(
  '/api/v1/hiring/uploads',
  createProxyMiddleware({
    target: env.hiringServiceUrl,
    changeOrigin: true,
    pathRewrite: { '^/api/v1/hiring/uploads': '/uploads' },
  } as any),
);

app.use(express.json());
app.use('/api/v1', v1Router);

app.listen(env.port, () => {
  console.log(`API gateway (Express) listening on http://localhost:${env.port}`);
});
