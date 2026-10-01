import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { CryptoService } from '../../common/crypto/crypto.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { assessmentWebhookSchema, type CreateAssessmentIntegrationDto, type CreateAssessmentRequestDto } from './dto/job.dto';

const INTEGRATION_SELECT = {
  id: true,
  provider: true,
  displayName: true,
  isActive: true,
  config: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.AssessmentIntegrationSelect;

/**
 * Vendor-neutral assessment boundary. It deliberately does not implement test
 * delivery or scoring: those stay with the specialist provider.
 */
@Injectable()
export class AssessmentIntegrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
  ) {}

  listIntegrations(tenantId: string) {
    return this.prisma.assessmentIntegration.findMany({ where: { tenantId }, select: INTEGRATION_SELECT, orderBy: { displayName: 'asc' } });
  }

  async createIntegration(user: AuthUser, dto: CreateAssessmentIntegrationDto) {
    const webhookSecret = randomBytes(32).toString('base64url');
    try {
      const integration = await this.prisma.assessmentIntegration.create({
        data: {
          tenantId: user.tenantId,
          provider: dto.provider,
          displayName: dto.displayName,
          config: dto.config as Prisma.InputJsonValue | undefined,
          webhookSecretEnc: this.crypto.encrypt(webhookSecret),
        },
        select: INTEGRATION_SELECT,
      });
      await this.audit.log({ tenantId: user.tenantId, userId: user.userId, action: 'ASSESSMENT_INTEGRATION_CREATED', resource: 'assessment-integrations', resourceId: integration.id, newValues: { provider: integration.provider, displayName: integration.displayName } });
      // This is intentionally the only response containing the secret. The
      // database holds only its encrypted form; use rotation if it is lost.
      return { ...integration, webhookSecret };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('This assessment provider is already configured for the tenant');
      throw error;
    }
  }

  async rotateWebhookSecret(user: AuthUser, id: string) {
    const webhookSecret = randomBytes(32).toString('base64url');
    const result = await this.prisma.assessmentIntegration.updateMany({ where: { id, tenantId: user.tenantId }, data: { webhookSecretEnc: this.crypto.encrypt(webhookSecret) } });
    if (!result.count) throw new NotFoundException('Assessment integration not found');
    await this.audit.log({ tenantId: user.tenantId, userId: user.userId, action: 'ASSESSMENT_WEBHOOK_SECRET_ROTATED', resource: 'assessment-integrations', resourceId: id });
    return { webhookSecret };
  }

  async createRequest(user: AuthUser, applicationId: string, dto: CreateAssessmentRequestDto) {
    const [application, integration] = await Promise.all([
      this.prisma.application.findFirst({ where: { id: applicationId, tenantId: user.tenantId }, select: { id: true } }),
      this.prisma.assessmentIntegration.findFirst({ where: { id: dto.integrationId, tenantId: user.tenantId, isActive: true }, select: { id: true, provider: true } }),
    ]);
    if (!application) throw new NotFoundException('Application not found');
    if (!integration) throw new BadRequestException('Assessment integration is unavailable');
    if (!dto.externalId) throw new BadRequestException('externalId from the assessment provider is required');
    try {
      return await this.prisma.$transaction(async (tx) => {
        const request = await tx.assessmentRequest.create({
          data: {
            tenantId: user.tenantId,
            applicationId,
            integrationId: integration.id,
            externalId: dto.externalId,
            assessmentUrl: dto.assessmentUrl,
            expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
          },
        });
        await tx.applicationEvent.create({
          data: {
            tenantId: user.tenantId,
            applicationId,
            actorUserId: user.userId,
            type: 'ASSESSMENT_REQUEST_LINKED',
            metadata: { assessmentRequestId: request.id, integrationId: integration.id, provider: integration.provider, externalId: dto.externalId },
          },
        });
        await tx.auditLog.create({
          data: { tenantId: user.tenantId, userId: user.userId, action: 'ASSESSMENT_REQUEST_LINKED', resource: 'assessment-requests', resourceId: request.id, newValues: { applicationId, provider: integration.provider, externalId: dto.externalId } },
        });
        return request;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('This provider assessment is already linked');
      throw error;
    }
  }

  async listRequests(tenantId: string, applicationId: string) {
    const application = await this.prisma.application.findFirst({ where: { id: applicationId, tenantId }, select: { id: true } });
    if (!application) throw new NotFoundException('Application not found');
    return this.prisma.assessmentRequest.findMany({
      where: { tenantId, applicationId },
      include: { integration: { select: { provider: true, displayName: true } } },
      orderBy: { requestedAt: 'desc' },
    });
  }

  /** Verifies a HMAC-SHA256 signature over the exact raw callback bytes. */
  async handleWebhook(integrationId: string, signature: string | undefined, rawBody: Buffer | undefined) {
    if (!signature || !rawBody) throw new BadRequestException('Missing assessment webhook signature or body');
    const integration = await this.prisma.assessmentIntegration.findFirst({ where: { id: integrationId, isActive: true }, select: { id: true, tenantId: true, webhookSecretEnc: true } });
    if (!integration) throw new NotFoundException('Assessment integration not found');
    const expected = createHmac('sha256', this.crypto.decrypt(integration.webhookSecretEnc)).update(rawBody).digest('hex');
    const supplied = signature.replace(/^sha256=/i, '');
    const expectedBytes = Buffer.from(expected, 'hex');
    const suppliedBytes = /^[a-f0-9]{64}$/i.test(supplied) ? Buffer.from(supplied, 'hex') : Buffer.alloc(0);
    if (expectedBytes.length !== suppliedBytes.length || !timingSafeEqual(expectedBytes, suppliedBytes)) throw new BadRequestException('Invalid assessment webhook signature');

    let payload: ReturnType<typeof assessmentWebhookSchema.parse>;
    try {
      payload = assessmentWebhookSchema.parse(JSON.parse(rawBody.toString('utf8')));
    } catch {
      throw new BadRequestException('Invalid assessment webhook payload');
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const existingEvent = await tx.assessmentWebhookEvent.findUnique({ where: { integrationId_providerEventId: { integrationId, providerEventId: payload.eventId } } });
        if (existingEvent) return { received: true, duplicate: true };
        const request = await tx.assessmentRequest.findUnique({ where: { integrationId_externalId: { integrationId, externalId: payload.externalId } } });
        if (!request) throw new NotFoundException('Assessment request not found');
        if (request.status !== 'PENDING' && payload.status === 'PENDING') throw new ConflictException('A completed assessment cannot return to pending');
        await tx.assessmentRequest.update({
          where: { id: request.id },
          data: {
            status: payload.status,
            score: payload.score,
            recommendation: payload.recommendation,
            reportUrl: payload.reportUrl,
            completedAt: payload.status === 'COMPLETED' ? (payload.completedAt ? new Date(payload.completedAt) : new Date()) : undefined,
          },
        });
        await tx.applicationEvent.create({
          data: {
            tenantId: request.tenantId,
            applicationId: request.applicationId,
            type: 'ASSESSMENT_STATUS_RECEIVED',
            metadata: { assessmentRequestId: request.id, providerEventId: payload.eventId, status: payload.status, score: payload.score ?? null, recommendation: payload.recommendation ?? null },
          },
        });
        await tx.assessmentWebhookEvent.create({ data: { integrationId, providerEventId: payload.eventId } });
        return { received: true, duplicate: false };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return { received: true, duplicate: true };
      throw error;
    }
  }
}
