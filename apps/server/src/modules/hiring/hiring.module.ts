import { Module } from '@nestjs/common';
import { HiringService } from './hiring.service';
import { HiringController } from './hiring.controller';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { BullModule } from '@nestjs/bullmq';
import { HiringProcessor } from './hiring.processor';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [
    PrismaModule,
    AiModule,
    BullModule.registerQueue({
      name: 'notifications',
    }),
    BullModule.registerQueue({
      name: 'hiring',
    }),
  ],
  controllers: [HiringController],
  providers: [HiringService, HiringProcessor],
})
export class HiringModule {}

