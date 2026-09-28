import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { EmployeesService } from './employees.service';
import { EmployeeLimitGuard } from '../../common/guards/employee-limit.guard';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import type { AuthUser } from '../../common/auth/auth-user';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  changeRoleSchema,
  createEmployeeSchema,
  listEmployeesSchema,
  offboardSchema,
  updateEmployeeSchema,
  type CreateEmployeeDto,
  type ListEmployeesQuery,
  type UpdateEmployeeDto,
} from './dto/create-employee.dto';

@ApiTags('Employees')
@ApiBearerAuth()
@Controller('employees')
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  /** Company directory. Admins get full records; everyone else gets directory fields. */
  @Get()
  list(@CurrentUser() user: AuthUser, @Query(new ZodValidationPipe(listEmployeesSchema)) q: ListEmployeesQuery) {
    return this.employees.list(user, q);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.employees.me(user);
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.employees.findOne(user, id);
  }

  @Post()
  @Roles('ADMIN')
  @UseGuards(EmployeeLimitGuard)
  create(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(createEmployeeSchema)) dto: CreateEmployeeDto) {
    return this.employees.create(user, dto);
  }

  @Patch(':id')
  @Roles('ADMIN')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(updateEmployeeSchema)) dto: UpdateEmployeeDto) {
    return this.employees.update(user, id, dto);
  }

  @Post(':id/offboard')
  @Roles('ADMIN')
  offboard(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(offboardSchema)) dto: { exitDate: string }) {
    return this.employees.offboard(user, id, dto.exitDate);
  }

  @Patch(':id/role')
  @Roles('ADMIN')
  changeRole(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(changeRoleSchema)) dto: { role: 'ADMIN' | 'MANAGER' | 'EMPLOYEE' }) {
    return this.employees.changeRole(user, id, dto.role);
  }
}
