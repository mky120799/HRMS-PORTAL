import { Controller, Get, Post, Body, UseGuards, Request, UsePipes, ForbiddenException } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { InternalAuthGuard } from '../../common/guards/internal-auth.guard';
import { createNotificationSchema, composeEmailSchema } from './dto/create-notification.dto';
import type { CreateNotificationDto, ComposeEmailDto } from './dto/create-notification.dto';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';

@Controller()
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post('internal/notifications')
  @UseGuards(InternalAuthGuard)
  @UsePipes(new ZodValidationPipe(createNotificationSchema))
  async createInternalNotification(@Body() dto: CreateNotificationDto) {
    // Requires tenantId in body for internal calls, otherwise pass "SYSTEM" or real tenantId
    const tenantId = (dto as any).tenantId || 'SYSTEM';
    return this.notificationsService.createNotification(tenantId, dto, true);
  }

  @Get('notifications')
  @UseGuards(JwtAuthGuard)
  async getNotifications(@Request() req: any) {
    return this.notificationsService.getNotifications(req.user.tenantId);
  }

  @Post('notifications')
  @UseGuards(JwtAuthGuard)
  @UsePipes(new ZodValidationPipe(createNotificationSchema))
  async createNotification(@Request() req: any, @Body() dto: CreateNotificationDto) {
    return this.notificationsService.createNotification(req.user.tenantId, dto);
  }

  @Post('notifications/compose-email')
  @UseGuards(JwtAuthGuard)
  @UsePipes(new ZodValidationPipe(composeEmailSchema))
  async composeEmail(@Request() req: any, @Body() dto: ComposeEmailDto) {
    if (req.user.role !== 'ADMIN') {
      throw new ForbiddenException('Only admins can send emails');
    }
    return this.notificationsService.composeEmail(req.user.tenantId, dto);
  }
}
