import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { CreateLeaveRequestDto } from './dto/create-leave.dto';

@Injectable()
export class LeavesService {
  constructor(private prisma: PrismaService) {}

  async findAll(tenantId: string) {
    return this.prisma.leaveRequest.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(tenantId: string, id: string) {
    return this.prisma.leaveRequest.findFirst({
      where: { id, tenantId },
    });
  }

  async create(tenantId: string, dto: CreateLeaveRequestDto) {
    // Validate employee exists
    const employee = await this.prisma.employee.findFirst({
      where: { id: dto.employeeId, tenantId },
    });
    if (!employee) {
      throw new NotFoundException('Employee not found');
    }

    return this.prisma.leaveRequest.create({
      data: {
        tenantId,
        employeeId: dto.employeeId,
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
        type: dto.type ?? 'ANNUAL',
        status: 'PENDING',
        reason: dto.reason,
      },
    });
  }
}
