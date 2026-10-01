import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { AiService } from '../ai/ai.service';
import { HIRING_QUEUE } from './hiring.service';
import { RabbitMqService } from '../../common/messaging/rabbitmq.service';

/**
 * Background resume screening consumer. Interview reminder scheduling and
 * durable side-effect delivery live in their own lifecycle-aware services.
 */
@Injectable()
export class HiringProcessor implements OnModuleInit {
  private readonly logger = new Logger(HiringProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly ai: AiService,
    private readonly rabbit: RabbitMqService,
  ) {}

  async onModuleInit() {
    await this.rabbit.consume<{ applicationId: string; tenantId: string }>(
      HIRING_QUEUE,
      (message) => this.process(message.payload),
      { concurrency: 2, attempts: 3, retryDelayMs: 60_000 },
    );
  }

  // ─── AI resume screening ────────────────────────────────────────────────────

  async process(job: { applicationId: string; tenantId: string }): Promise<void> {
    const app = await this.prisma.application.findFirst({
      where: { id: job.applicationId, tenantId: job.tenantId },
      include: { job: true },
    });
    if (!app?.resumeKey) return;

    const text = await this.ai.extractText(await this.storage.getBuffer(app.resumeKey), app.resumeMimeType ?? '');
    if (text.length < 100) {
      await this.prisma.$transaction([
        this.prisma.application.update({
          where: { id: app.id },
          data: { aiScore: null, aiReason: 'Automatic screening skipped: resume text could not be read (non-PDF or scanned document). Review manually.', aiScoredAt: new Date() },
        }),
        this.prisma.applicationEvent.create({ data: { tenantId: app.tenantId, applicationId: app.id, type: 'AI_SCREENING_SKIPPED', metadata: { reason: 'RESUME_TEXT_UNREADABLE' } } }),
      ]);
      return;
    }

    const result = await this.ai.screenResume(app.job, text);
    const reason = [result.summary, result.strengths.length ? `Strengths: ${result.strengths.join('; ')}` : '', result.gaps.length ? `Gaps: ${result.gaps.join('; ')}` : '']
      .filter(Boolean)
      .join('\n');
    await this.prisma.$transaction([
      this.prisma.application.update({ where: { id: app.id }, data: { aiScore: result.score, aiReason: reason, aiScoredAt: new Date() } }),
      this.prisma.applicationEvent.create({ data: { tenantId: app.tenantId, applicationId: app.id, type: 'AI_SCREENING_COMPLETED', metadata: { score: result.score } } }),
    ]);
    this.logger.log(`Screened application ${app.id}: ${result.score}`);
  }

}
