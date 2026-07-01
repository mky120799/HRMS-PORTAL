import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { FastifyRequest } from 'fastify';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const { method, url } = req;
    const start = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const elapsed = Date.now() - start;
          this.logger.log(`${method} ${url} — ${elapsed}ms`);
        },
        error: (err) => {
          const elapsed = Date.now() - start;
          this.logger.warn(`${method} ${url} — ${elapsed}ms [ERROR: ${err.status ?? 500}]`);
        },
      }),
    );
  }
}
