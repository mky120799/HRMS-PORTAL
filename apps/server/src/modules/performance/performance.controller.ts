import { Controller, Get, Post, Patch, Param, Body, UseGuards, Request } from '@nestjs/common';
import { PerformanceService } from './performance.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller('performance')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PerformanceController {
  constructor(private readonly performanceService: PerformanceService) {}

  @Get('me')
  async getMyReviews(@Request() req) {
    if (!req.user.employeeId) return [];
    return this.performanceService.getMyReviews(req.user.tenantId, req.user.employeeId);
  }

  @Get('team')
  @Roles('ADMIN', 'MANAGER')
  async getTeamReviews(@Request() req) {
    // In a real app, this would get reviews for the manager's direct reports
    if (!req.user.employeeId) return [];
    return this.performanceService.getReviewsToManager(req.user.tenantId, req.user.employeeId);
  }

  @Get('all')
  @Roles('ADMIN')
  async getAllReviews(@Request() req) {
    return this.performanceService.getAllReviews(req.user.tenantId);
  }

  @Post('cycle')
  @Roles('ADMIN')
  async createCycle(@Request() req, @Body() body: { cycleName: string }) {
    return this.performanceService.createReviewCycle({
      tenantId: req.user.tenantId,
      cycleName: body.cycleName,
    });
  }

  @Patch(':id/self')
  async submitSelfReview(@Param('id') id: string, @Request() req, @Body() body: { selfRating: number; comments: string }) {
    return this.performanceService.submitSelfReview(id, req.user.tenantId, req.user.employeeId, body.selfRating, body.comments);
  }

  @Patch(':id/manager')
  @Roles('ADMIN', 'MANAGER')
  async submitManagerReview(@Param('id') id: string, @Request() req, @Body() body: { managerRating: number; comments: string }) {
    return this.performanceService.submitManagerReview(id, req.user.tenantId, req.user.employeeId, body.managerRating, body.comments);
  }
}
