import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  Sse,
} from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { FastifyRequest } from 'fastify';
import { NotificationsService } from './notifications.service';
import { NotificationOperationsService } from './notification-operations.service';
import { NotificationEmailWebhookService } from './notification-email-webhook.service';
import { NotificationRealtimeService } from './notification-realtime.service';
import type { Observable } from 'rxjs';
import { CurrentUser, Permissions, Public } from '../../common/auth/decorators';
import type { AuthUser } from '../../common/auth/auth-user';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  composeEmailSchema,
  createNotificationCampaignSchema,
  createNotificationTemplateSchema,
  emailWebhookSchema,
  listNotificationsSchema,
  updateNotificationSettingsSchema,
  updateNotificationPreferenceSchema,
  type ComposeEmailDto,
  type CreateNotificationCampaignDto,
  type CreateNotificationTemplateDto,
  type EmailWebhookDto,
  type ListNotificationsQuery,
  type UpdateNotificationSettingsDto,
  type UpdateNotificationPreferenceDto,
} from './dto/notification.dto';

@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly operations: NotificationOperationsService,
    private readonly emailWebhook: NotificationEmailWebhookService,
    private readonly realtime: NotificationRealtimeService,
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

  @Sse('stream')
  stream(@CurrentUser() user: AuthUser): Observable<MessageEvent> {
    return this.realtime.stream(user);
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

  @Get('settings')
  settings(@CurrentUser() user: AuthUser) {
    return this.notifications.deliverySettings(user);
  }

  @Put('settings')
  updateSettings(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(updateNotificationSettingsSchema))
    dto: UpdateNotificationSettingsDto,
  ) {
    return this.notifications.updateDeliverySettings(user, dto);
  }

  @Put('read-all')
  markAllRead(@CurrentUser() user: AuthUser) {
    return this.notifications.markAllRead(user);
  }

  @Get('campaigns')
  @Permissions('notifications.manage')
  campaigns(@CurrentUser() user: AuthUser) {
    return this.notifications.listCampaigns(user);
  }

  @Get('campaigns/:id')
  @Permissions('notifications.manage')
  campaign(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.notifications.campaign(user, id);
  }

  @Post('campaigns')
  @Permissions('notifications.manage')
  @Throttle({ default: { limit: 20, ttl: 60 * 60_000 } })
  createCampaign(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createNotificationCampaignSchema))
    dto: CreateNotificationCampaignDto,
  ) {
    return this.notifications.createCampaign(user, dto);
  }

  @Post('campaigns/:id/cancel')
  @Permissions('notifications.manage')
  cancelCampaign(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.notifications.cancelCampaign(user, id);
  }

  @Get('operations')
  @Permissions('notifications.manage')
  operationsOverview(@CurrentUser() user: AuthUser) {
    return this.operations.overview(user.tenantId);
  }

  @Get('suppressions')
  @Permissions('notifications.manage')
  suppressions(@CurrentUser() user: AuthUser) {
    return this.notifications.suppressions(user);
  }

  @Get('templates')
  @Permissions('notifications.manage')
  templates(@CurrentUser() user: AuthUser) {
    return this.notifications.templates(user);
  }

  @Post('templates')
  @Permissions('notifications.manage')
  createTemplate(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createNotificationTemplateSchema))
    dto: CreateNotificationTemplateDto,
  ) {
    return this.notifications.createTemplate(user, dto);
  }

  @Post('templates/:id/activate')
  @Permissions('notifications.manage')
  activateTemplate(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.notifications.activateTemplate(user, id);
  }

  @Post('suppressions/:id/unsuppress')
  @Permissions('notifications.manage')
  unsuppress(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.notifications.unsuppress(user, id);
  }

  @Post('deliveries/:id/retry')
  @Permissions('notifications.manage')
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
  @Permissions('notifications.manage')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  compose(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(composeEmailSchema)) dto: ComposeEmailDto,
  ) {
    return this.notifications.composeEmail(user, dto);
  }

  @Post('announce')
  @Permissions('notifications.manage')
  @Throttle({ default: { limit: 5, ttl: 60 * 60_000 } })
  announce(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createNotificationCampaignSchema))
    dto: CreateNotificationCampaignDto,
  ) {
    return this.notifications.announce(user, dto);
  }

  @Public()
  @SkipThrottle()
  @Post('email/webhook')
  @HttpCode(200)
  @ApiExcludeEndpoint()
  webhook(
    @Headers('x-hrms-signature') signature: string | undefined,
    @Req() req: RawBodyRequest<FastifyRequest>,
    @Body(new ZodValidationPipe(emailWebhookSchema)) dto: EmailWebhookDto,
  ) {
    return this.emailWebhook.handle(signature, req.rawBody, dto);
  }
}
