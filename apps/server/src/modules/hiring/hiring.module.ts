import { Module } from '@nestjs/common';
import { HiringService } from './hiring.service';
import { AssessmentWebhookController, CareersController, HiringController } from './hiring.controller';
import { AssessmentIntegrationService } from './assessment-integration.service';
import { HiringWorkflowService } from './hiring-workflow.service';
import { HiringFeedbackService } from './hiring-feedback.service';
import { HiringProcessor } from './hiring.processor';
import { HiringOutboxService } from './hiring-outbox.service';
import { HiringOutboxProcessor } from './hiring-outbox.processor';
import { HiringScheduler } from './hiring.scheduler';
import { HiringInterviewService } from './hiring-interview.service';
import { AiModule } from '../ai/ai.module';
import { IntegrationsModule } from '../integrations/integrations.module';

@Module({
  imports: [AiModule, IntegrationsModule],
  controllers: [CareersController, HiringController, AssessmentWebhookController],
  providers: [
    HiringService,
    AssessmentIntegrationService,
    HiringWorkflowService,
    HiringFeedbackService,
    HiringOutboxService,
    HiringOutboxProcessor,
    HiringScheduler,
    HiringInterviewService,
    HiringProcessor,
  ],
})
export class HiringModule {}
