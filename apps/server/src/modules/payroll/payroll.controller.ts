import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PayrollService } from './payroll.service';
import { CurrentUser, Permissions, RequireStepUp } from '../../common/auth/decorators';
import type { AuthUser } from '../../common/auth/auth-user';
import { RequiresPlan } from '../../common/decorators/plan.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { periodSchema, upsertSalarySchema, type PeriodDto, type UpsertSalaryDto } from './dto/payroll.dto';

@ApiTags('Payroll')
@ApiBearerAuth()
@Controller('payroll')
@RequiresPlan('BASIC')
export class PayrollController {
  constructor(private readonly payroll: PayrollService) {}

  @Get('my-payslips')
  myPayslips(@CurrentUser() user: AuthUser) {
    return this.payroll.myPayslips(user);
  }

  @Get('payslips/:id/pdf')
  async payslipPdf(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const { pdf, filename } = await this.payroll.payslipPdf(user, id);
    return new StreamableFile(pdf, { type: 'application/pdf', disposition: `attachment; filename="${filename}"` });
  }

  @Get('salaries')
  @Permissions('payroll.salary.manage')
  listSalaries(@CurrentUser() user: AuthUser) {
    return this.payroll.listSalaries(user.tenantId);
  }

  @Put('salaries/:employeeId')
  @RequireStepUp()
  @Permissions('payroll.salary.manage')
  upsertSalary(@CurrentUser() user: AuthUser, @Param('employeeId', ParseUUIDPipe) employeeId: string, @Body(new ZodValidationPipe(upsertSalarySchema)) dto: UpsertSalaryDto) {
    return this.payroll.upsertSalary(user, employeeId, dto);
  }

  @Get('runs')
  @Permissions('payroll.read', 'payroll.run.manage')
  getRun(@CurrentUser() user: AuthUser, @Query(new ZodValidationPipe(periodSchema)) q: PeriodDto) {
    return this.payroll.getRun(user.tenantId, q.year, q.month);
  }

  @Post('runs/generate')
  @Permissions('payroll.run.manage')
  generate(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(periodSchema)) dto: PeriodDto) {
    return this.payroll.generate(user, dto.year, dto.month);
  }

  @Post('runs/finalize')
  @RequireStepUp()
  @Permissions('payroll.finalize')
  finalize(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(periodSchema)) dto: PeriodDto) {
    return this.payroll.finalize(user, dto.year, dto.month);
  }
}
