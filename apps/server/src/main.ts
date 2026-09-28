import './instrument';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ConfigService } from '@nestjs/config';
import { WinstonModule } from 'nest-winston';
import * as winston from 'winston';
import { randomUUID } from 'crypto';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';

function createLogger() {
  const isProd = process.env.NODE_ENV === 'production';
  return WinstonModule.createLogger({
    level: process.env.LOG_LEVEL ?? 'info',
    transports: [
      new winston.transports.Console({
        format: isProd
          ? winston.format.combine(winston.format.timestamp(), winston.format.json()) // machine-parseable for CloudWatch
          : winston.format.combine(
              winston.format.colorize(),
              winston.format.timestamp(),
              winston.format.printf((i) => `${i.timestamp} ${i.level} [${i.context ?? 'App'}] ${i.message}`),
            ),
      }),
    ],
  });
}

export function createAdapter() {
  return new FastifyAdapter({
    trustProxy: process.env.TRUST_PROXY === 'true', // only behind our own load balancer
    bodyLimit: 1024 * 1024, // 1 MB JSON; uploads use multipart limits
    requestIdHeader: 'x-request-id',
    genReqId: () => randomUUID(),
  });
}

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, createAdapter(), {
    rawBody: true, // Stripe webhook signature verification needs the exact bytes
    logger: createLogger(),
    bufferLogs: true,
  });
  await configureApp(app);
  await app.listen(Number(app.get(ConfigService).get('PORT')), '0.0.0.0');
}

if (require.main === module) void bootstrap();
