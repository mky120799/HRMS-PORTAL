import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

/** Success envelope: { success: true, data, timestamp }. Errors use GlobalExceptionFilter's shape. */
@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, { success: true; data: T; timestamp: string }> {
  intercept(_context: ExecutionContext, next: CallHandler<T>): Observable<{ success: true; data: T; timestamp: string }> {
    return next.handle().pipe(map((data) => ({ success: true as const, data, timestamp: new Date().toISOString() })));
  }
}
