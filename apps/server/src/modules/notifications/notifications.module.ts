import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { NotificationPublisherService } from './notification-publisher.service';
import { NotificationOutboxProcessor } from './notification-outbox.processor';
import { NotificationCampaignProcessor } from './notification-campaign.processor';
import { NotificationOperationsService } from './notification-operations.service';
import { NotificationRetentionService } from './notification-retention.service';

@Module({
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationPublisherService,
    NotificationOutboxProcessor,
    NotificationCampaignProcessor,
    NotificationOperationsService,
    NotificationRetentionService,
  ],
  exports: [NotificationPublisherService],
})
export class NotificationsModule {}
