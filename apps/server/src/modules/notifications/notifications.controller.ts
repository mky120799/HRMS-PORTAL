import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { NotificationsService } from './notifications.service';
import { NotificationOperationsService } from './notification-operations.service';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import type { AuthUser } from '../../common/auth/auth-user';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  composeEmailSchema,
  createNotificationCampaignSchema,
  listNotificationsSchema,
  updateNotificationPreferenceSchema,
  type ComposeEmailDto,
  type CreateNotificationCampaignDto,
  type ListNotificationsQuery,
  type UpdateNotificationPreferenceDto,
} from './dto/notification.dto';

@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly operations: NotificationOperationsService,
  ) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(listNotificationsSchema))
    q: ListNotificationsQuery,
  ) {
    return this.notifications.list(user, q);
  }

  @Get('unread-count')
  unreadCount(@CurrentUser() user: AuthUser) {
    return this.notifications.unreadCount(user);
  }

  @Get('preferences')
  preferences(@CurrentUser() user: AuthUser) {
    return this.notifications.listPreferences(user);
  }

  @Put('preferences')
  updatePreference(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(updateNotificationPreferenceSchema))
    dto: UpdateNotificationPreferenceDto,
  ) {
    return this.notifications.updatePreference(user, dto);
  }

  @Put('read-all')
  markAllRead(@CurrentUser() user: AuthUser) {
    return this.notifications.markAllRead(user);
  }

  @Get('campaigns')
  @Roles('ADMIN')
  campaigns(@CurrentUser() user: AuthUser) {
    return this.notifications.listCampaigns(user);
  }

  @Get('campaigns/:id')
  @Roles('ADMIN')
  campaign(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.notifications.campaign(user, id);
  }

  @Post('campaigns')
  @Roles('ADMIN')
  @Throttle({ default: { limit: 20, ttl: 60 * 60_000 } })
  createCampaign(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createNotificationCampaignSchema))
    dto: CreateNotificationCampaignDto,
  ) {
    return this.notifications.createCampaign(user, dto);
  }

  @Post('campaigns/:id/cancel')
  @Roles('ADMIN')
  cancelCampaign(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.notifications.cancelCampaign(user, id);
  }

  @Get('operations')
  @Roles('ADMIN')
  operationsOverview(@CurrentUser() user: AuthUser) {
    return this.operations.overview(user.tenantId);
  }

  @Post('deliveries/:id/retry')
  @Roles('ADMIN')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  retryDelivery(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.operations.retryEmail(user.tenantId, id);
  }

  @Post(':id/read')
  markRead(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.notifications.markRead(user, id);
  }

  @Put(':id/read')
  markReadPut(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.notifications.markRead(user, id);
  }

  @Put(':id/archive')
  archive(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.notifications.archive(user, id);
  }

  @Post('compose-email')
  @Roles('ADMIN')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  compose(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(composeEmailSchema)) dto: ComposeEmailDto,
  ) {
    return this.notifications.composeEmail(user, dto);
  }

  @Post('announce')
  @Roles('ADMIN')
  @Throttle({ default: { limit: 5, ttl: 60 * 60_000 } })
  announce(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createNotificationCampaignSchema))
    dto: CreateNotificationCampaignDto,
  ) {
    return this.notifications.announce(user, dto);
  }
}
