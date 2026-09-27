import './instrument';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { WinstonModule } from 'nest-winston';
import * as winston from 'winston';
import multipart from '@fastify/multipart';
import helmet from '@fastify/helmet';
import { randomUUID } from 'crypto';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import type { Env } from './config/env';

function createLogger() {
  const isProd = process.env.NODE_ENV === 'production';
  return WinstonModule.createLogger({
    level: process.env.LOG_LEVEL ?? 'info',
    transports: [
      new winston.transports.Console({
        format: isProd
          ? winston.format.combine(winston.format.timestamp(), winston.format.json()) // machine-parseable for CloudWatch
          : winston.format.combine(winston.format.colorize(), winston.format.timestamp(), winston.format.printf((i) => `${i.timestamp} ${i.level} [${i.context ?? 'App'}] ${i.message}`)),
      }),
    ],
  });
}

async function bootstrap() {
  const adapter = new FastifyAdapter({
    trustProxy: process.env.TRUST_PROXY === 'true', // only behind our own load balancer
    bodyLimit: 1024 * 1024, // 1 MB JSON; uploads use multipart limits below
    requestIdHeader: 'x-request-id',
    genReqId: () => randomUUID(),
  });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    rawBody: true, // Stripe webhook signature verification needs the exact bytes
    logger: createLogger(),
    bufferLogs: true,
  });
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
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 20 } });

  const origins = config.get('CORS_ORIGINS', { infer: true }).split(',').map((o) => o.trim()).filter(Boolean);
  app.enableCors({ origin: origins, credentials: false, exposedHeaders: ['x-request-id', 'content-disposition'] });

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

  await app.listen(config.get('PORT', { infer: true }), '0.0.0.0');
}

void bootstrap();
