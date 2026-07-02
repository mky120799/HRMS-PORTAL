import { Module } from '@nestjs/common';
import { SlackService } from './slack.service';
import { CalendarService } from './calendar.service';
import { BullModule } from '@nestjs/bullmq';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'notifications' }),
  ],
  providers: [SlackService, CalendarService],
  exports: [SlackService, CalendarService],
})
export class IntegrationsModule {}
