import { CallHandler, ExecutionContext, Injectable, NestInterceptor, StreamableFile } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

/**
 * Success envelope: { success: true, data, timestamp }. File downloads
 * (StreamableFile) pass through untouched. Errors use GlobalExceptionFilter's shape.
 */
@Injectable()
export class TransformInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((data) => (data instanceof StreamableFile ? data : { success: true as const, data, timestamp: new Date().toISOString() })),
    );
  }
}
