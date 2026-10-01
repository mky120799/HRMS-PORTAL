import { Module } from '@nestjs/common';
import { HiringService } from './hiring.service';
import { CareersController, HiringController } from './hiring.controller';
import { HiringProcessor } from './hiring.processor';
import { AiModule } from '../ai/ai.module';
import { IntegrationsModule } from '../integrations/integrations.module';

@Module({
  imports: [AiModule, IntegrationsModule],
  controllers: [CareersController, HiringController],
  providers: [HiringService, HiringProcessor],
})
export class HiringModule {}
