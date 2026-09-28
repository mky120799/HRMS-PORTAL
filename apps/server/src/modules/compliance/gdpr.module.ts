import { Module } from '@nestjs/common';
import { GdprService } from './gdpr.service';
import { GdprController } from './gdpr.controller';

@Module({
  controllers: [GdprController],
  providers: [GdprService],
})
export class GdprModule {}
