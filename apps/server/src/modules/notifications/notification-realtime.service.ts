import { Injectable, MessageEvent } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import type { AuthUser } from '../../common/auth/auth-user';

@Injectable()
export class NotificationRealtimeService {
  private readonly streams = new Map<string, Subject<MessageEvent>>();

  stream(user: AuthUser): Observable<MessageEvent> {
    const key = this.key(user.tenantId, user.userId);
    const subject = this.subject(key);
    return new Observable<MessageEvent>((subscriber) => {
      subscriber.next({ type: 'ready', data: { connected: true } });
      const subscription = subject.subscribe(subscriber);
      return () => subscription.unsubscribe();
    });
  }

  notifyUser(tenantId: string, userId: string, eventType: string) {
    this.subject(this.key(tenantId, userId)).next({
      type: 'notification',
      data: { eventType, at: new Date().toISOString() },
    });
  }

  private subject(key: string) {
    let subject = this.streams.get(key);
    if (!subject) {
      subject = new Subject<MessageEvent>();
      this.streams.set(key, subject);
    }
    return subject;
  }

  private key(tenantId: string, userId: string) {
    return `${tenantId}:${userId}`;
  }
}
