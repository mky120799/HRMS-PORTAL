import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

/** One structured line per request: method, path, status, latency, request/tenant/user ids. */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    const start = Date.now();
    const path = (req.url as string).split('?')[0]; // never log query strings (tokens, PII)
    if (path.startsWith('/api/v1/health')) return next.handle();

    const line = (status: number) =>
      `${req.method} ${path} ${status} ${Date.now() - start}ms reqId=${req.id} tenant=${req.user?.tenantId ?? '-'} user=${req.user?.userId ?? '-'}`;

    return next.handle().pipe(
      tap({
        next: () => this.logger.log(line(context.switchToHttp().getResponse().statusCode)),
        error: (err) => this.logger.warn(line(err?.status ?? 500)),
      }),
    );
  }
}
