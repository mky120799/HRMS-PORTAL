import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { PerformanceService } from './performance.service';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import type { AuthUser } from '../../common/auth/auth-user';
import { RequiresPlan } from '../../common/decorators/plan.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';

const cycleSchema = z.object({ cycleName: z.string().trim().min(2).max(60) });
const selfSchema = z.object({ selfRating: z.number().int().min(1).max(5), comments: z.string().trim().min(1).max(4000) });
const managerSchema = z.object({ managerRating: z.number().int().min(1).max(5), comments: z.string().trim().min(1).max(4000) });
const allQuery = z.object({ cycleName: z.string().max(60).optional() });

@ApiTags('Performance')
@ApiBearerAuth()
@Controller('performance')
@RequiresPlan('BUSINESS')
export class PerformanceController {
  constructor(private readonly performance: PerformanceService) {}

  @Get('me')
  mine(@CurrentUser() user: AuthUser) {
    return this.performance.mine(user);
  }

  @Get('team')
  @Roles('ADMIN', 'MANAGER')
  team(@CurrentUser() user: AuthUser) {
    return this.performance.team(user);
  }

  @Get('all')
  @Roles('ADMIN')
  all(@CurrentUser() user: AuthUser, @Query(new ZodValidationPipe(allQuery)) q: z.infer<typeof allQuery>) {
    return this.performance.all(user.tenantId, q.cycleName);
  }

  @Get('cycles')
  @Roles('ADMIN')
  cycles(@CurrentUser() user: AuthUser) {
    return this.performance.cycles(user.tenantId);
  }

  @Post('cycle')
  @Roles('ADMIN')
  openCycle(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(cycleSchema)) dto: z.infer<typeof cycleSchema>) {
    return this.performance.openCycle(user.tenantId, dto.cycleName);
  }

  @Patch(':id/self')
  submitSelf(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(selfSchema)) dto: z.infer<typeof selfSchema>) {
    return this.performance.submitSelf(user, id, dto.selfRating, dto.comments);
  }

  @Patch(':id/manager')
  @Roles('ADMIN', 'MANAGER')
  submitManager(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(managerSchema)) dto: z.infer<typeof managerSchema>) {
    return this.performance.submitManager(user, id, dto.managerRating, dto.comments);
  }
}
