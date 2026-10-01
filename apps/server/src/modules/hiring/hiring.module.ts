import { Module } from '@nestjs/common';
import { HiringService } from './hiring.service';
import { AssessmentWebhookController, CareersController, HiringController } from './hiring.controller';
import { AssessmentIntegrationService } from './assessment-integration.service';
import { HiringWorkflowService } from './hiring-workflow.service';
import { HiringProcessor } from './hiring.processor';
import { AiModule } from '../ai/ai.module';
import { IntegrationsModule } from '../integrations/integrations.module';

@Module({
  imports: [AiModule, IntegrationsModule],
  controllers: [CareersController, HiringController, AssessmentWebhookController],
  providers: [HiringService, AssessmentIntegrationService, HiringWorkflowService, HiringProcessor],
})
export class HiringModule {}
