import { Controller, Get, Post, Body, Param, UseGuards, Request, UsePipes, NotFoundException } from '@nestjs/common';
import { EmployeesService } from './employees.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { createEmployeeSchema } from './dto/create-employee.dto';
import type { CreateEmployeeDto } from './dto/create-employee.dto';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';

@Controller('employees')
@UseGuards(JwtAuthGuard)
export class EmployeesController {
  constructor(private readonly employeesService: EmployeesService) {}

  @Get()
  async findAll(@Request() req: any) {
    return this.employeesService.findAll(req.user.tenantId);
  }

  @Post()
  @UsePipes(new ZodValidationPipe(createEmployeeSchema))
  async create(@Request() req: any, @Body() dto: CreateEmployeeDto) {
    return this.employeesService.create(req.user.tenantId, dto);
  }

  @Get(':id')
  async findOne(@Request() req: any, @Param('id') id: string) {
    const employee = await this.employeesService.findOne(req.user.tenantId, id);
    if (!employee) {
      throw new NotFoundException('Employee not found');
    }
    return employee;
  }
}
