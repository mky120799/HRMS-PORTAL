import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { RenderedEmail } from '../../common/email/templates';

export type HiringOutboxType = 'EMAIL' | 'HIRING_QUEUE' | 'SLACK_NEW_APPLICATION';

@Injectable()
export class HiringOutboxService {
  enqueueEmail(
    tx: Prisma.TransactionClient,
    input: {
      tenantId: string;
      applicationId: string;
      eventKey: string;
      to: string;
      recipientUserId?: string | null;
      email: RenderedEmail;
    },
  ) {
    return tx.hiringOutboxEvent.create({
      data: {
        tenantId: input.tenantId,
        applicationId: input.applicationId,
        eventKey: input.eventKey,
        type: 'EMAIL',
        payload: {
          to: input.to,
          recipientUserId: input.recipientUserId ?? null,
          subject: input.email.subject,
          html: input.email.html,
          text: input.email.text,
        },
      },
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
