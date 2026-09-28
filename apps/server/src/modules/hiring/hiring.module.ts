import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { HiringService, HIRING_QUEUE } from './hiring.service';
import { CareersController, HiringController } from './hiring.controller';
import { HiringProcessor } from './hiring.processor';
import { AiModule } from '../ai/ai.module';
import { IntegrationsModule } from '../integrations/integrations.module';

@Module({
  imports: [AiModule, IntegrationsModule, BullModule.registerQueue({ name: HIRING_QUEUE })],
  controllers: [CareersController, HiringController],
  providers: [HiringService, HiringProcessor],
})
export class HiringModule {}
