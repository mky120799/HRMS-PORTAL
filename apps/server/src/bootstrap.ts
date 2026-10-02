import { ConfigService } from '@nestjs/config';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import multipart from '@fastify/multipart';
import helmet from '@fastify/helmet';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import type { Env } from './config/env';

/**
 * HTTP pipeline shared by main.ts and the e2e tests, so tests exercise exactly
 * what runs in production (prefix, security headers, CORS, upload limits, filter).
 */
export async function configureApp(app: NestFastifyApplication): Promise<void> {
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  app.getHttpAdapter()
    .getInstance()
    .addHook('onSend', async (request, reply) => {
      void reply.header('x-request-id', request.id);
    });

  await app.register(helmet, {
    contentSecurityPolicy: false, // JSON API; the SPA's CSP is set by nginx
    crossOriginResourcePolicy: { policy: 'same-site' },
  });
  // application/x-www-form-urlencoded (the SAML ACS POST) is parsed by Nest's own
  // body parser; registering a second parser makes app.init() throw.
  // SCIM clients (Okta, Entra ID) send JSON as application/scim+json.
  app.getHttpAdapter()
    .getInstance()
    .addContentTypeParser('application/scim+json', { parseAs: 'string' }, (_request, body, done) => {
      try {
        done(null, body === '' ? {} : JSON.parse(String(body)));
      } catch (error) {
        done(Object.assign(error as Error, { statusCode: 400 }), undefined);
      }
    });
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 20 } });

  const origins = config.get('CORS_ORIGINS', { infer: true }).split(',').map((o) => o.trim()).filter(Boolean);
  // credentials: the refresh token travels in an httpOnly cookie (scoped to /api/v1/auth).
  // Safe with an explicit origin allow-list; never combine with a wildcard origin.
  app.enableCors({ origin: origins, credentials: true, exposedHeaders: ['x-request-id', 'content-disposition'] });

  app.useGlobalFilters(new GlobalExceptionFilter());
  app.setGlobalPrefix('api/v1');
  app.enableShutdownHooks(); // drain in-flight requests and queue workers on SIGTERM

  const swaggerEnabled = config.get('ENABLE_SWAGGER', { infer: true }) ?? config.get('NODE_ENV', { infer: true }) !== 'production';
  if (swaggerEnabled) {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('HRMS API').setDescription('Multi-tenant HRMS API').setVersion('1.0').addBearerAuth().build(),
    );
    SwaggerModule.setup('api/docs', app, doc);
  }
}
