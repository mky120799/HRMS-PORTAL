import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import multipart from '@fastify/multipart';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter()
  );
  
  await app.register(multipart, {
    limits: { fileSize: 10 * 1024 * 1024 }
  });

  app.useGlobalFilters(new GlobalExceptionFilter());

  // Enable shutdown hooks for graceful shutdown (0 downtime deployments)
  app.enableShutdownHooks();

  // Enable CORS
  app.enableCors();

  // Listen on 0.0.0.0 for Docker/ECS compatibility
  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}
bootstrap();
