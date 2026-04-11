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
    if (regRes.status >= 400) {
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
    const r = await client.post(`${env.authServiceUrl}/auth/login`, req.body);
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
