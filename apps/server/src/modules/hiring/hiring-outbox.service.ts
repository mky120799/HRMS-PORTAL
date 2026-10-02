import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { RenderedEmail } from '../../common/email/templates';
import { NotificationPublisherService } from '../notifications/notification-publisher.service';

export type HiringOutboxType = 'EMAIL' | 'HIRING_QUEUE' | 'SLACK_NEW_APPLICATION';

@Injectable()
export class HiringOutboxService {
  constructor(private readonly notifications: NotificationPublisherService) {}

  enqueueEmail(
    tx: Prisma.TransactionClient,
    input: {
      tenantId: string;
      applicationId: string;
      eventKey: string;
      eventType: string;
      to: string;
      recipientUserId?: string | null;
      email: RenderedEmail;
    },
  ) {
    return this.notifications.publish(tx, {
      tenantId: input.tenantId,
      eventKey: input.eventKey,
      eventType: input.eventType,
      category: 'HIRING',
      data: { applicationId: input.applicationId },
      recipients: [
        { userId: input.recipientUserId ?? null, email: input.to },
      ],
      channels: input.recipientUserId ? ['IN_APP', 'EMAIL'] : ['EMAIL'],
      title: input.email.subject,
      body: input.email.text,
      link: input.recipientUserId ? '/hiring' : undefined,
      email: input.email,
    });
  }

  enqueueHiringJob(tx: Prisma.TransactionClient, input: { tenantId: string; applicationId: string; eventKey: string; jobType: string; payload: Prisma.InputJsonValue }) {
    return tx.hiringOutboxEvent.create({
      data: { tenantId: input.tenantId, applicationId: input.applicationId, eventKey: input.eventKey, type: 'HIRING_QUEUE', payload: { jobType: input.jobType, data: input.payload } },
    });
  }

  enqueueSlackApplication(tx: Prisma.TransactionClient, input: { tenantId: string; applicationId: string; eventKey: string; jobTitle: string; candidateName: string }) {
    return tx.hiringOutboxEvent.create({
      data: {
        tenantId: input.tenantId,
        applicationId: input.applicationId,
        eventKey: input.eventKey,
        type: 'SLACK_NEW_APPLICATION',
        payload: { jobTitle: input.jobTitle, candidateName: input.candidateName },
      },
    });
  }
}
