import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * One error shape for every failure:
 *   { success: false, statusCode, code, message, errors?, requestId, timestamp }
 * - Known Prisma errors map to meaningful HTTP codes (unique → 409, missing → 404).
 * - Unexpected errors are logged with the request id and reported to Sentry,
 *   but the client only sees a generic message (no stack traces / SQL leaks).
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: Record<string, unknown> = { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' };

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      body = typeof res === 'string' ? { message: res } : { ...(res as object) };
      body.code ??= HttpStatus[status] ?? 'ERROR';
      delete body.statusCode;
      delete body.error;
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        status = HttpStatus.CONFLICT;
        body = { code: 'CONFLICT', message: 'A record with these details already exists' };
      } else if (exception.code === 'P2025') {
        status = HttpStatus.NOT_FOUND;
        body = { code: 'NOT_FOUND', message: 'Record not found' };
      } else if (exception.code === 'P2003') {
        status = HttpStatus.BAD_REQUEST;
        body = { code: 'INVALID_REFERENCE', message: 'A referenced record does not exist' };
      }
    } else if ((exception as any)?.statusCode === 413 || (exception as any)?.code === 'FST_REQ_FILE_TOO_LARGE') {
      status = HttpStatus.PAYLOAD_TOO_LARGE;
      body = { code: 'PAYLOAD_TOO_LARGE', message: 'Upload is too large' };
    }

    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.url} failed [requestId=${request.id}]`,
        exception instanceof Error ? exception.stack : String(exception),
      );
      Sentry.captureException(exception, { tags: { requestId: String(request.id) } });
    }

    void reply.status(status).send({
      success: false,
      statusCode: status,
      ...body,
      requestId: request.id,
      timestamp: new Date().toISOString(),
    });
  }
}
