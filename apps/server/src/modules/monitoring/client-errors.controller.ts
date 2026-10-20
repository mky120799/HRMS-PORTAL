import { Body, Controller, HttpCode, Logger, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import * as Sentry from '@sentry/nestjs';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Public } from '../../common/auth/decorators';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';

// Control characters are stripped so a crafted report cannot forge extra log lines.
const text = (max: number) => z.string().max(max * 4).transform((s) => s.replace(/[\u0000-\u001f\u007f]+/g, ' ').slice(0, max));

const clientErrorSchema = z.object({
  source: z.enum(['boundary', 'window', 'unhandledrejection', 'query', 'chunk']),
  message: text(500),
  stack: text(4000).optional(),
  path: text(300), // the web app sends the pathname only — never the query string, which can carry reset/invite tokens
  release: text(64).optional(),
});
type ClientErrorDto = z.infer<typeof clientErrorSchema>;

/**
 * POST /client-errors — crashes reported by the web app.
 *
 * The browser reports to its own origin (the CSP allows `connect-src 'self'` only)
 * and the API forwards to the same Sentry project as server errors. Public because
 * the login and careers pages crash too; a tight per-IP limit keeps it from being
 * used to flood the logs. No user or tenant data is accepted or attached.
 */
@ApiTags('monitoring')
@Public()
@Throttle({ default: { limit: 10, ttl: 60_000 } })
@Controller('client-errors')
export class ClientErrorsController {
  private readonly logger = new Logger('WebClient');

  @Post()
  @HttpCode(204)
  report(@Body(new ZodValidationPipe(clientErrorSchema)) dto: ClientErrorDto, @Req() req: FastifyRequest) {
    this.logger.warn(`[${dto.source}] ${dto.message} at ${dto.path} (release ${dto.release ?? 'unknown'}, request ${String(req.id)})`);

    const error = new Error(dto.message);
    error.name = 'WebClientError';
    if (dto.stack) error.stack = dto.stack;
    Sentry.captureException(error, {
      tags: { origin: 'web', source: dto.source, release: dto.release ?? 'unknown' },
      extra: { path: dto.path, userAgent: req.headers['user-agent'] },
    });
  }
}
