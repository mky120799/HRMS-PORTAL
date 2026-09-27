import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AuditService } from './audit.service';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Records every successful state-changing request by an authenticated user.
 * Request bodies are deliberately NOT stored (they contain passwords, salaries,
 * personal data); services add before/after values for sensitive changes.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    if (!MUTATING.has(req.method) || !req.user) return next.handle();

    const segments = (req.url as string).split('?')[0].replace(/^\/api\/v1\//, '').split('/');
    const resource = segments[0] || 'root';
    const resourceId = segments.find((s) => UUID.test(s)) ?? null;
    const action = `${req.method} /${segments.map((s) => (UUID.test(s) ? ':id' : s)).join('/')}`;

    return next.handle().pipe(
      tap(() => {
        void this.audit.log({
          tenantId: req.user.tenantId,
          userId: req.user.userId,
          action,
          resource,
          resourceId,
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
          requestId: String(req.id),
        });
      }),
    );
  }
}
