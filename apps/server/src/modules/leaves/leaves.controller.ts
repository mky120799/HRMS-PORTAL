import { Controller, Get, Post, Body, Param, UseGuards, Request, UsePipes, NotFoundException, Patch } from '@nestjs/common';
import { LeavesService } from './leaves.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { createLeaveRequestSchema } from './dto/create-leave.dto';
import type { CreateLeaveRequestDto } from './dto/create-leave.dto';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';

@Controller('leave-requests')
@UseGuards(JwtAuthGuard)
export class LeavesController {
  constructor(private readonly leavesService: LeavesService) {}

  @Get()
  async findAll(@Request() req: any) {
    return this.leavesService.findAll(req.user.tenantId);
  }

  @Post()
  @UsePipes(new ZodValidationPipe(createLeaveRequestSchema))
  async create(@Request() req: any, @Body() dto: CreateLeaveRequestDto) {
    return this.leavesService.create(req.user.tenantId, dto);
  }

  @Get(':id')
  async findOne(@Request() req: any, @Param('id') id: string) {
    const leave = await this.leavesService.findOne(req.user.tenantId, id);
    if (!leave) {
      throw new NotFoundException('Leave request not found');
    }
    return leave;
  }

  @Patch(':id/status')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'MANAGER')
  async updateStatus(
    @Request() req: any,
    @Param('id') id: string,
    @Body('status') status: 'APPROVED' | 'REJECTED',
  ) {
    return this.leavesService.updateStatus(req.user.tenantId, id, status, req.user.name ?? 'Admin');
  }
}
