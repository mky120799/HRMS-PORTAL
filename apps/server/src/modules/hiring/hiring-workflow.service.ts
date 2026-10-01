import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';
import type { ApplicationStatus } from '../../common/constants/domain';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EmailTemplates } from '../../common/email/templates';
import type { CreateHiringStageDto, MoveApplicationDto, ReorderHiringStagesDto, UpdateHiringStageDto } from './dto/job.dto';
import { HiringOutboxService } from './hiring-outbox.service';

const DEFAULT_STAGES = [
  { key: 'APPLIED', name: 'Applied', category: 'APPLIED', position: 10 },
  { key: 'SCREENING', name: 'Screening', category: 'SCREENING', position: 20 },
  { key: 'INTERVIEW', name: 'Interview', category: 'INTERVIEW', position: 30 },
  { key: 'OFFERED', name: 'Offer', category: 'OFFERED', position: 40 },
  { key: 'HIRED', name: 'Hired', category: 'HIRED', position: 50 },
  { key: 'REJECTED', name: 'Rejected', category: 'REJECTED', position: 60 },
] as const;

const ALLOWED_CATEGORY_TRANSITIONS: Record<ApplicationStatus, ApplicationStatus[]> = {
  APPLIED: ['SCREENING', 'INTERVIEW', 'REJECTED'],
  SCREENING: ['INTERVIEW', 'REJECTED'],
  INTERVIEW: ['OFFERED', 'REJECTED'],
  OFFERED: ['HIRED', 'REJECTED'],
  HIRED: [],
  REJECTED: [],
};

const STAGE_SELECT = {
  id: true,
  key: true,
  name: true,
  category: true,
  position: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.HiringStageSelect;

/** Owns tenant-configurable pipeline stages and immutable application events. */
@Injectable()
export class HiringWorkflowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly outbox: HiringOutboxService,
  ) {}

  async listStages(tenantId: string) {
    await this.ensureDefaultStages(tenantId);
    return this.prisma.hiringStage.findMany({ where: { tenantId }, select: STAGE_SELECT, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] });
  }

  async defaultStage(tenantId: string, category: ApplicationStatus = 'APPLIED') {
    await this.ensureDefaultStages(tenantId);
    const stage = await this.prisma.hiringStage.findFirst({ where: { tenantId, category, isActive: true }, select: STAGE_SELECT, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] });
    if (!stage) throw new ConflictException(`No active ${category.toLowerCase()} hiring stage is configured`);
    return stage;
  }

  async createStage(user: AuthUser, dto: CreateHiringStageDto) {
    await this.ensureDefaultStages(user.tenantId);
    try {
      const stage = await this.prisma.hiringStage.create({ data: { tenantId: user.tenantId, ...dto }, select: STAGE_SELECT });
      await this.audit.log({ tenantId: user.tenantId, userId: user.userId, action: 'HIRING_STAGE_CREATED', resource: 'hiring-stages', resourceId: stage.id, newValues: { key: stage.key, category: stage.category, position: stage.position } });
      return stage;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('A hiring stage with this key already exists');
      throw error;
    }
  }

  async updateStage(user: AuthUser, id: string, dto: UpdateHiringStageDto) {
    const current = await this.prisma.hiringStage.findFirst({ where: { id, tenantId: user.tenantId }, select: { id: true, category: true, isActive: true } });
    if (!current) throw new NotFoundException('Hiring stage not found');
    if (current.isActive && dto.isActive === false) {
      const alternatives = await this.prisma.hiringStage.count({ where: { tenantId: user.tenantId, category: current.category, isActive: true, id: { not: id } } });
      if (!alternatives) throw new ConflictException(`At least one active ${current.category.toLowerCase()} stage is required`);
    }
    const result = await this.prisma.hiringStage.updateMany({ where: { id, tenantId: user.tenantId }, data: dto });
    if (!result.count) throw new NotFoundException('Hiring stage not found');
    const stage = await this.prisma.hiringStage.findUniqueOrThrow({ where: { id }, select: STAGE_SELECT });
    await this.audit.log({ tenantId: user.tenantId, userId: user.userId, action: 'HIRING_STAGE_UPDATED', resource: 'hiring-stages', resourceId: id, newValues: dto });
    return stage;
  }

  async reorderStages(user: AuthUser, dto: ReorderHiringStagesDto) {
    const stages = await this.prisma.hiringStage.findMany({ where: { tenantId: user.tenantId }, select: { id: true } });
    const expected = new Set(stages.map((stage) => stage.id));
    if (dto.stageIds.length !== expected.size || dto.stageIds.some((id) => !expected.has(id))) {
      throw new ConflictException('The reorder request must contain every hiring stage exactly once');
    }
    await this.prisma.$transaction(async (tx) => {
      await Promise.all(dto.stageIds.map((id, index) => tx.hiringStage.update({ where: { id }, data: { position: (index + 1) * 10 } })));
      await tx.auditLog.create({ data: { tenantId: user.tenantId, userId: user.userId, action: 'HIRING_STAGES_REORDERED', resource: 'hiring-stages', newValues: { stageIds: dto.stageIds } } });
    });
    return this.listStages(user.tenantId);
  }

  async timeline(tenantId: string, applicationId: string) {
    const application = await this.prisma.application.findFirst({ where: { id: applicationId, tenantId }, select: { id: true } });
    if (!application) throw new NotFoundException('Application not found');
    return this.prisma.applicationEvent.findMany({
      where: { tenantId, applicationId },
      include: { actor: { select: { id: true, name: true, email: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  async move(user: AuthUser, applicationId: string, dto: MoveApplicationDto) {
    await this.ensureDefaultStages(user.tenantId);
    const target = await this.prisma.hiringStage.findFirst({ where: { id: dto.stageId, tenantId: user.tenantId, isActive: true }, select: STAGE_SELECT });
    if (!target) throw new NotFoundException('Target hiring stage not found or inactive');
    return this.moveToStage(user, applicationId, target, dto.note);
  }

  async moveToCategory(user: AuthUser, applicationId: string, category: ApplicationStatus, note?: string) {
    const target = await this.defaultStage(user.tenantId, category);
    return this.moveToStage(user, applicationId, target, note);
  }

  private async moveToStage(user: AuthUser, applicationId: string, target: Prisma.HiringStageGetPayload<{ select: typeof STAGE_SELECT }>, note?: string) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const application = await tx.application.findFirst({
          where: { id: applicationId, tenantId: user.tenantId },
          include: { stage: { select: STAGE_SELECT }, job: { select: { title: true } }, tenant: { select: { name: true } } },
        });
        if (!application) throw new NotFoundException('Application not found');
        if (application.stageId === target.id) return tx.application.findUniqueOrThrow({ where: { id: applicationId }, include: { stage: { select: STAGE_SELECT } } });

        const currentCategory = application.status as ApplicationStatus;
        const currentStage = application.stage ?? await tx.hiringStage.findFirst({ where: { tenantId: user.tenantId, category: currentCategory, isActive: true }, select: STAGE_SELECT, orderBy: { position: 'asc' } });
        if (!currentStage) throw new ConflictException(`No current ${currentCategory.toLowerCase()} hiring stage is configured`);
        const isRejection = target.category === 'REJECTED' && currentCategory !== 'REJECTED';
        const isBackward = !isRejection && (target.position < currentStage.position || (['HIRED', 'REJECTED'].includes(currentCategory) && target.category !== currentCategory));
        if (isBackward && user.role !== 'ADMIN') throw new ConflictException('Only admins can move an application backward');
        if (isBackward && !note?.trim()) throw new ConflictException('A reason is required when moving an application backward');
        if (!isBackward && user.role !== 'ADMIN' && ['OFFERED', 'HIRED'].includes(target.category)) {
          throw new ConflictException('Only admins can offer a role or mark a candidate as hired');
        }
        if (!isBackward && currentCategory !== target.category && !ALLOWED_CATEGORY_TRANSITIONS[currentCategory]?.includes(target.category as ApplicationStatus)) {
          throw new ConflictException(`Cannot move an application from ${currentCategory} to ${target.category}`);
        }
        const updated = await tx.application.updateMany({
          where: { id: applicationId, tenantId: user.tenantId, status: application.status, stageId: application.stageId },
          data: { stageId: target.id, status: target.category },
        });
        if (!updated.count) throw new ConflictException('This application changed before the stage could be updated');
        const timelineEvent = await tx.applicationEvent.create({
          data: {
            tenantId: user.tenantId,
            applicationId,
            actorUserId: user.userId,
            type: isBackward ? 'STAGE_ROLLED_BACK' : 'STAGE_CHANGED',
            note,
            metadata: { fromStatus: currentCategory, fromStageId: currentStage.id, fromStageName: currentStage.name, toStatus: target.category, toStageId: target.id, toStageName: target.name },
          },
        });
        await tx.auditLog.create({
          data: { tenantId: user.tenantId, userId: user.userId, action: isBackward ? 'APPLICATION_STAGE_ROLLED_BACK' : 'APPLICATION_STAGE_CHANGED', resource: 'hiring', resourceId: applicationId, oldValues: { status: currentCategory, stageId: currentStage.id }, newValues: { status: target.category, stageId: target.id, note } },
        });
        if (currentCategory !== target.category && ['SCREENING', 'OFFERED', 'HIRED', 'REJECTED'].includes(target.category)) {
          await this.outbox.enqueueEmail(tx, {
            tenantId: user.tenantId,
            applicationId,
            eventKey: `application-status:${timelineEvent.id}`,
            to: application.candidateEmail,
            email: EmailTemplates.applicationStatus({ candidateName: application.candidateName, jobTitle: application.job.title, companyName: application.tenant.name, status: target.category }),
          });
        }
        return tx.application.findUniqueOrThrow({ where: { id: applicationId }, include: { stage: { select: STAGE_SELECT } } });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') throw new NotFoundException('Application not found');
      throw error;
    }
  }

  private async ensureDefaultStages(tenantId: string) {
    await this.prisma.hiringStage.createMany({
      data: DEFAULT_STAGES.map((stage) => ({ tenantId, ...stage })),
      skipDuplicates: true,
    });
  }
}
