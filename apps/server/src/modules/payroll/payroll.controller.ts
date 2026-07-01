import { Controller, Post, Get, UseGuards, Request, Body, Param, UsePipes } from '@nestjs/common';
import { PayrollService } from './payroll.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { updateSalarySchema, UpdateSalaryDto, generatePayslipSchema, GeneratePayslipDto } from './dto/payroll.dto';

@ApiTags('Payroll')
@ApiBearerAuth()
@Controller('payroll')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PayrollController {
  constructor(private readonly payrollService: PayrollService) {}

  @Post('structure/:employeeId')
  @Roles('ADMIN')
  @UsePipes(new ZodValidationPipe(updateSalarySchema))
  async updateSalaryStructure(
    @Request() req: any,
    @Param('employeeId') employeeId: string,
    @Body() dto: UpdateSalaryDto
  ) {
    return this.payrollService.updateSalaryStructure(req.user.tenantId, employeeId, dto);
  }

  @Post('generate-payslip/:employeeId')
  @Roles('ADMIN')
  @UsePipes(new ZodValidationPipe(generatePayslipSchema))
  async generatePayslip(
    @Request() req: any,
    @Param('employeeId') employeeId: string,
    @Body() dto: GeneratePayslipDto
  ) {
    return this.payrollService.generatePayslip(req.user.tenantId, employeeId, dto.month, dto.year);
  }

  @Get('my-payslips')
  @Roles('EMPLOYEE', 'MANAGER', 'ADMIN')
  async getMyPayslips(@Request() req: any) {
    return this.payrollService.getMyPayslips(req.user.tenantId, req.user.sub);
  }
}
