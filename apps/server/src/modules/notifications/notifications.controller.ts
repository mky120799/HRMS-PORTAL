import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { NotificationsService } from './notifications.service';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import type { AuthUser } from '../../common/auth/auth-user';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  announceSchema,
  composeEmailSchema,
  listNotificationsSchema,
  type AnnounceDto,
  type ComposeEmailDto,
  type ListNotificationsQuery,
} from './dto/notification.dto';

@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query(new ZodValidationPipe(listNotificationsSchema)) q: ListNotificationsQuery) {
    return this.notifications.list(user, q);
  }

  @Post(':id/read')
  markRead(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.notifications.markRead(user, id);
  }

  @Post('compose-email')
  @Roles('ADMIN')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  compose(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(composeEmailSchema)) dto: ComposeEmailDto) {
    return this.notifications.composeEmail(user, dto);
  }

  @Post('announce')
  @Roles('ADMIN')
  @Throttle({ default: { limit: 5, ttl: 60 * 60_000 } })
  announce(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(announceSchema)) dto: AnnounceDto) {
    return this.notifications.announce(user, dto);
  }
}
