import { Controller, Get, Post, Body, UseGuards, Request } from '@nestjs/common';
import { PayrollService } from './payroll.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller('payroll')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PayrollController {
  constructor(private readonly payrollService: PayrollService) {}

  @Get('my-payslips')
  async getMyPayslips(@Request() req) {
    // Only fetch for employees
    if (!req.user.employeeId) return [];
    return this.payrollService.getMyPayslips(req.user.tenantId, req.user.employeeId);
  }

  @Get('all')
  @Roles('ADMIN', 'MANAGER')
  async getAllPayslips(@Request() req) {
    return this.payrollService.getAllPayslips(req.user.tenantId);
  }

  @Post('generate')
  @Roles('ADMIN')
  async generatePayslips(@Request() req, @Body() body: { month: number, year: number }) {
    return this.payrollService.generatePayslips(req.user.tenantId, body.month, body.year);
  }
}
