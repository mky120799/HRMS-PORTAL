import axios from 'axios';
import { Router } from 'express';
import type { z } from 'zod';
import { env } from '../env';
import { loginBodySchema, signupBodySchema } from '../schemas';
import { sendUpstreamError } from '../upstream';
import { validateBody } from '../validation';

const client = axios.create({ timeout: 30_000, validateStatus: () => true });

function internalHeaders(): Record<string, string> {
  return { 'x-internal-secret': env.internalServiceSecret };
}

function forwardAuth(authorization: string | undefined): Record<string, string> {
  return typeof authorization === 'string' ? { Authorization: authorization } : {};
}

export const v1Router = Router();

v1Router.get('/health', (_req, res) => {
  res.json({ service: 'api-gateway', status: 'ok', runtime: 'express' });
});

v1Router.get('/health/all', async (_req, res) => {
  const services = [
    { name: 'auth', url: `${env.authServiceUrl}/health` },
    { name: 'tenant', url: `${env.tenantServiceUrl}/health` },
    { name: 'employee', url: `${env.employeeServiceUrl}/health` },
    { name: 'leave', url: `${env.leaveServiceUrl}/health` },
    { name: 'notifications', url: `${env.notificationsServiceUrl}/health` },
  ];

  const results = await Promise.all(
    services.map(async (s) => {
      try {
        const r = await client.get(s.url, { timeout: 2000 });
        return { name: s.name, status: 'UP', data: r.data };
      } catch (e: any) {
        return { name: s.name, status: 'DOWN', error: e.message };
      }
    }),
  );

  const allUp = results.every((r) => r.status === 'UP');
  res.status(allUp ? 200 : 207).json({
    timestamp: new Date().toISOString(),
    overall: allUp ? 'HEALTHY' : 'DEGRADED',
    services: results,
  });
});

v1Router.post('/auth/signup', validateBody(signupBodySchema), async (req, res) => {
  const { tenantName, email, password, name } = req.body as z.infer<typeof signupBodySchema>;

  try {
    let tenantRes = await client.post(
      `${env.tenantServiceUrl}/internal/tenants`,
      { name: tenantName },
      { headers: internalHeaders() },
    );
    if (tenantRes.status >= 400) {
      res.status(tenantRes.status).json(tenantRes.data);
      return;
    }

    const tenant = tenantRes.data as { id: string; name: string; slug: string };

    const regRes = await client.post(
      `${env.authServiceUrl}/internal/register`,
      { tenantId: tenant.id, email, password, name },
      { headers: internalHeaders() },
    );
    if (regRes.status >= 400 && regRes.status !== 409) {
      res.status(regRes.status).json(regRes.data);
      return;
    }

    const loginRes = await client.post(`${env.authServiceUrl}/auth/login`, {
      tenantId: tenant.id,
      email,
      password,
    });
    if (loginRes.status >= 400) {
      res.status(loginRes.status).json(loginRes.data);
      return;
    }

    res.status(201).json({
      tenant,
      ...loginRes.data,
    });
  } catch (e) {
    sendUpstreamError(res, e);
  }
});

v1Router.post('/auth/login', validateBody(loginBodySchema), async (req, res) => {
  try {
    const { tenantId, email, password } = req.body;

    const tRes = await client.get(`${env.tenantServiceUrl}/internal/tenants/lookup/${tenantId}`, {
      headers: internalHeaders(),
    });

    if (tRes.status >= 400) {
      res.status(tRes.status).json({ message: 'Tenant not found or invalid' });
      return;
    }

    const tenant = tRes.data;

    const r = await client.post(`${env.authServiceUrl}/auth/login`, {
      tenantId: tenant.id,
      email,
      password,
    });
    res.status(r.status).json(r.data);
  } catch (e) {
    sendUpstreamError(res, e);
  }
});

v1Router.get('/auth/me', async (req, res) => {
  try {
    const r = await client.get(`${env.authServiceUrl}/auth/me`, {
      headers: forwardAuth(req.headers.authorization),
    });
    res.status(r.status).json(r.data);
  } catch (e) {
    sendUpstreamError(res, e);
  }
});

v1Router.get('/employees', async (req, res) => {
  try {
    const r = await client.get(`${env.employeeServiceUrl}/employees`, {
      headers: forwardAuth(req.headers.authorization),
    });
    res.status(r.status).json(r.data);
  } catch (e) {
    sendUpstreamError(res, e);
  }
});

v1Router.post('/employees', async (req, res) => {
  try {
    const r = await client.post(`${env.employeeServiceUrl}/employees`, req.body, {
      headers: forwardAuth(req.headers.authorization),
    });
    res.status(r.status).json(r.data);
  } catch (e) {
    sendUpstreamError(res, e);
  }
});

v1Router.get('/employees/:id', async (req, res) => {
  try {
    const r = await client.get(`${env.employeeServiceUrl}/employees/${req.params.id}`, {
      headers: forwardAuth(req.headers.authorization),
    });
    res.status(r.status).json(r.data);
  } catch (e) {
    sendUpstreamError(res, e);
  }
});

v1Router.get('/leave-requests', async (req, res) => {
  try {
    const r = await client.get(`${env.leaveServiceUrl}/leave-requests`, {
      headers: forwardAuth(req.headers.authorization),
    });
    res.status(r.status).json(r.data);
  } catch (e) {
    sendUpstreamError(res, e);
  }
});

v1Router.post('/leave-requests', async (req, res) => {
  try {
    const r = await client.post(`${env.leaveServiceUrl}/leave-requests`, req.body, {
      headers: forwardAuth(req.headers.authorization),
    });
    res.status(r.status).json(r.data);
  } catch (e) {
    sendUpstreamError(res, e);
  }
});

v1Router.get('/leave-requests/:id', async (req, res) => {
  try {
    const r = await client.get(`${env.leaveServiceUrl}/leave-requests/${req.params.id}`, {
      headers: forwardAuth(req.headers.authorization),
    });
    res.status(r.status).json(r.data);
  } catch (e) {
    sendUpstreamError(res, e);
  }
});

v1Router.get('/notifications', async (req, res) => {
  try {
    const r = await client.get(`${env.notificationsServiceUrl}/notifications`, {
      headers: forwardAuth(req.headers.authorization),
    });
    res.status(r.status).json(r.data);
  } catch (e) {
    sendUpstreamError(res, e);
  }
});

v1Router.post('/notifications', async (req, res) => {
  try {
    const r = await client.post(`${env.notificationsServiceUrl}/notifications`, req.body, {
      headers: forwardAuth(req.headers.authorization),
    });
    res.status(r.status).json(r.data);
  } catch (e) {
    sendUpstreamError(res, e);
  }
});

v1Router.get('/hiring/jobs', async (req, res) => {
  try {
    const r = await client.get(`${env.hiringServiceUrl}/jobs`, {
      headers: forwardAuth(req.headers.authorization),
    });
    res.status(r.status).json(r.data);
  } catch (e) {
    sendUpstreamError(res, e);
  }
});

v1Router.post('/hiring/jobs', async (req, res) => {
  try {
    const r = await client.post(`${env.hiringServiceUrl}/jobs`, req.body, {
      headers: forwardAuth(req.headers.authorization),
    });
    res.status(r.status).json(r.data);
  } catch (e) {
    sendUpstreamError(res, e);
  }
});

v1Router.get('/hiring/applications', async (req, res) => {
  try {
    const r = await client.get(`${env.hiringServiceUrl}/applications`, {
      headers: forwardAuth(req.headers.authorization),
    });
    res.status(r.status).json(r.data);
  } catch (e) {
    sendUpstreamError(res, e);
  }
});

v1Router.post('/hiring/applications', async (req, res) => {
  try {
    const r = await client.post(`${env.hiringServiceUrl}/applications`, req.body, {
      headers: forwardAuth(req.headers.authorization),
    });
    res.status(r.status).json(r.data);
  } catch (e) {
    sendUpstreamError(res, e);
  }
});
