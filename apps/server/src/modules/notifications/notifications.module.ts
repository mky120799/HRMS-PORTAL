import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { NotificationPublisherService } from './notification-publisher.service';
import { NotificationOutboxProcessor } from './notification-outbox.processor';

@Module({
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationPublisherService,
    NotificationOutboxProcessor,
  ],
  exports: [NotificationPublisherService],
})
export class NotificationsModule {}
