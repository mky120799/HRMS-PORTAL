import { Module } from '@nestjs/common';
import { LeavesService } from './leaves.service';
import { LeavesController } from './leaves.controller';
import { IntegrationsModule } from '../integrations/integrations.module';
import { LeavesProcessor } from './leaves.processor';
import { LeavesScheduler } from './leaves.scheduler';

@Module({
  imports: [IntegrationsModule],
  controllers: [LeavesController],
  providers: [LeavesService, LeavesProcessor, LeavesScheduler],
  exports: [LeavesService],
})
export class LeavesModule {}
