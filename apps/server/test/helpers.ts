import { Test } from '@nestjs/testing';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { randomBytes } from 'crypto';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { createAdapter } from '../src/main';

export interface TestResponse {
  status: number;
  body: any;
  headers: Record<string, any>;
  raw: Buffer;
}

export class TestClient {
  constructor(readonly app: NestFastifyApplication) {}

  static async create(): Promise<TestClient> {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication<NestFastifyApplication>(createAdapter(), { rawBody: true, logger: ['error'] });
    await configureApp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    return new TestClient(app);
  }

  /** Each call gets a random client IP unless given, so per-IP rate limits don't interfere across tests. */
  async request(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    url: string,
    opts: { token?: string; body?: unknown; ip?: string; payload?: Buffer; headers?: Record<string, string> } = {},
  ): Promise<TestResponse> {
    const res = await this.app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method,
        url: `/api/v1${url}`,
        remoteAddress: opts.ip ?? `10.${rnd()}.${rnd()}.${rnd()}`,
        headers: { ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}), ...(opts.headers ?? {}) },
        ...(opts.payload ? { payload: opts.payload } : opts.body !== undefined ? { payload: opts.body as any } : {}),
      });
    let body: any = res.body;
    try {
      body = JSON.parse(res.body);
    } catch {
      /* non-JSON (files) */
    }
    return { status: res.statusCode, body, headers: res.headers, raw: res.rawPayload };
  }

  async signup(company = `Co ${unique()}`) {
    const email = `admin-${unique()}@example.com`;
    const res = await this.request('POST', '/auth/signup', { body: { tenantName: company, name: 'Ada Admin', email, password: PASSWORD } });
    if (res.status !== 201) throw new Error(`signup failed: ${res.status} ${JSON.stringify(res.body)}`);
    const d = res.body.data;
    return { token: d.accessToken as string, refreshToken: d.refreshToken as string, user: d.user, tenant: d.tenant, email };
  }

  close() {
    return this.app.close();
  }
}

export const PASSWORD = 'Str0ng-Passw0rd!';
const rnd = () => Math.floor(Math.random() * 250) + 1;
export const unique = () => randomBytes(4).toString('hex');

/** Builds a multipart/form-data body. Fields are written before the file so the server sees them. */
export function multipart(fields: Record<string, string>, file?: { field: string; filename: string; content: Buffer; type: string }) {
  const boundary = `----hrms${unique()}`;
  const chunks: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  if (file) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${file.filename}"\r\nContent-Type: ${file.type}\r\n\r\n`));
    chunks.push(file.content, Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(chunks), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

export const FAKE_PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
