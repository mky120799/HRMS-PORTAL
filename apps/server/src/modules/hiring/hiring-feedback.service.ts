import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '../../common/auth/auth-user';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { UpsertFeedbackDto } from './dto/job.dto';

const FEEDBACK_SELECT = {
  id: true,
  rating: true,
  recommendation: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  author: { select: { id: true, name: true, email: true } },
} satisfies Prisma.InterviewFeedbackSelect;

const RECOMMENDATION_LABELS: Record<string, string> = {
  STRONG_YES: 'Strong Yes',
  YES: 'Yes',
  NEUTRAL: 'Neutral',
  NO: 'No',
  STRONG_NO: 'Strong No',
};

/** Manages per-interviewer structured feedback for an application. */
@Injectable()
export class HiringFeedbackService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** List all feedback records for an application and compute aggregate stats. */
  async list(tenantId: string, applicationId: string) {
    const application = await this.prisma.application.findFirst({
      where: { id: applicationId, tenantId },
      select: { id: true },
    });
    if (!application) throw new NotFoundException('Application not found');

    const items = await this.prisma.interviewFeedback.findMany({
      where: { tenantId, applicationId },
      select: FEEDBACK_SELECT,
      orderBy: { createdAt: 'asc' },
    });

    const avg = items.length ? items.reduce((s, f) => s + f.rating, 0) / items.length : null;
    const tally = Object.fromEntries(
      ['STRONG_YES', 'YES', 'NEUTRAL', 'NO', 'STRONG_NO'].map((r) => [
        r,
        items.filter((f) => f.recommendation === r).length,
      ]),
    );
    return { items, aggregate: { count: items.length, averageRating: avg ? Math.round(avg * 10) / 10 : null, tally } };
  }

  /**
   * Upsert feedback for the calling user — one record per application per author.
   * Sending feedback twice updates it rather than creating a duplicate.
   */
  async upsert(user: AuthUser, applicationId: string, dto: UpsertFeedbackDto) {
    const application = await this.prisma.application.findFirst({
      where: { id: applicationId, tenantId: user.tenantId },
      select: { id: true },
    });
    if (!application) throw new NotFoundException('Application not found');

    const existing = await this.prisma.interviewFeedback.findUnique({
      where: { applicationId_authorUserId: { applicationId, authorUserId: user.userId } },
      select: { id: true },
    });

    if (existing) {
      const updated = await this.prisma.interviewFeedback.update({
        where: { id: existing.id },
        data: { rating: dto.rating, recommendation: dto.recommendation, notes: dto.notes ?? null },
        select: FEEDBACK_SELECT,
      });
      await this.prisma.applicationEvent.create({
        data: {
          tenantId: user.tenantId,
          applicationId,
          actorUserId: user.userId,
          type: 'FEEDBACK_UPDATED',
          metadata: { rating: dto.rating, recommendation: dto.recommendation },
        },
      });
      await this.audit.log({
        tenantId: user.tenantId,
        userId: user.userId,
        action: 'INTERVIEW_FEEDBACK_UPDATED',
        resource: 'hiring',
        resourceId: applicationId,
        newValues: { rating: dto.rating, recommendation: RECOMMENDATION_LABELS[dto.recommendation] },
      });
      return updated;
    }

    const created = await this.prisma.interviewFeedback.create({
      data: {
        tenantId: user.tenantId,
        applicationId,
        authorUserId: user.userId,
        rating: dto.rating,
        recommendation: dto.recommendation,
        notes: dto.notes ?? null,
      },
      select: FEEDBACK_SELECT,
    });
    await this.prisma.applicationEvent.create({
      data: {
        tenantId: user.tenantId,
        applicationId,
        actorUserId: user.userId,
        type: 'FEEDBACK_SUBMITTED',
        metadata: { rating: dto.rating, recommendation: dto.recommendation },
      },
    });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: 'INTERVIEW_FEEDBACK_SUBMITTED',
      resource: 'hiring',
      resourceId: applicationId,
      newValues: { rating: dto.rating, recommendation: RECOMMENDATION_LABELS[dto.recommendation] },
    });
    return created;
  }

  /** Delete the calling user's own feedback (e.g. mistaken submission). */
  async remove(user: AuthUser, applicationId: string) {
    const result = await this.prisma.interviewFeedback.deleteMany({
      where: { applicationId, tenantId: user.tenantId, authorUserId: user.userId },
    });
    if (!result.count) throw new NotFoundException('Feedback not found or already deleted');
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: 'INTERVIEW_FEEDBACK_DELETED',
      resource: 'hiring',
      resourceId: applicationId,
    });
    return { deleted: true };
  }
}
