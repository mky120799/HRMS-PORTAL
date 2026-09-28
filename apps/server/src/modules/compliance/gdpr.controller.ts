import { Controller, Delete, Get, Param, ParseUUIDPipe, Post, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { GdprService } from './gdpr.service';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import type { AuthUser } from '../../common/auth/auth-user';

@ApiTags('Privacy')
@ApiBearerAuth()
@Controller('gdpr')
export class GdprController {
  constructor(private readonly gdpr: GdprService) {}

  /** Any user can export their own data (a legal right, so not plan-gated). */
  @Get('export')
  @Throttle({ default: { limit: 3, ttl: 60 * 60_000 } })
  async export(@CurrentUser() user: AuthUser) {
    const data = await this.gdpr.exportMyData(user);
    return new StreamableFile(Buffer.from(JSON.stringify(data, null, 2)), {
      type: 'application/json',
      disposition: `attachment; filename="my-data-${new Date().toISOString().slice(0, 10)}.json"`,
    });
  }

  @Post('employees/:id/erase')
  @Roles('ADMIN')
  erase(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.gdpr.eraseEmployee(user, id);
  }

  @Delete('applications/:id')
  @Roles('ADMIN')
  deleteApplication(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.gdpr.deleteApplication(user, id);
  }
}
