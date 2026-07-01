import { Controller, Post, UseGuards, Request, Get } from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

@ApiTags('Attendance')
@ApiBearerAuth()
@Controller('attendance')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @Post('clock-in')
  @Roles('EMPLOYEE', 'MANAGER', 'ADMIN')
  async clockIn(@Request() req: any) {
    return this.attendanceService.clockIn(req.user.tenantId, req.user.sub);
  }

  @Post('clock-out')
  @Roles('EMPLOYEE', 'MANAGER', 'ADMIN')
  async clockOut(@Request() req: any) {
    return this.attendanceService.clockOut(req.user.tenantId, req.user.sub);
  }

  @Get('me')
  @Roles('EMPLOYEE', 'MANAGER', 'ADMIN')
  async getMyAttendance(@Request() req: any) {
    return this.attendanceService.getMyAttendance(req.user.tenantId, req.user.sub);
  }
}
