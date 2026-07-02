import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SlackService } from '../integrations/slack.service';
import type { CreateLeaveRequestDto } from './dto/create-leave.dto';

@Injectable()
export class LeavesService {
  constructor(
    private prisma: PrismaService,
    private slackService: SlackService,
  ) {}

  async findAll(tenantId: string) {
    return this.prisma.leaveRequest.findMany({
      where: { tenantId },
      include: { employee: { select: { firstName: true, lastName: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(tenantId: string, id: string) {
    return this.prisma.leaveRequest.findFirst({
      where: { id, tenantId },
    });
  }

  async create(tenantId: string, dto: CreateLeaveRequestDto) {
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

  async updateStatus(tenantId: string, id: string, status: 'APPROVED' | 'REJECTED', approvedByName: string) {
    const leave = await this.prisma.leaveRequest.findFirst({
      where: { id, tenantId },
      include: { employee: { select: { firstName: true, lastName: true } } },
    });

    if (!leave) throw new NotFoundException('Leave request not found');

    const updated = await this.prisma.leaveRequest.update({
      where: { id },
      data: { status },
    });

    // Fire Slack notification asynchronously — non-blocking
    this.slackService.sendLeaveApprovalNotification({
      employeeName: `${leave.employee.firstName} ${leave.employee.lastName}`,
      leaveType: leave.type,
      startDate: leave.startDate,
      endDate: leave.endDate,
      status,
      approvedBy: approvedByName,
    }).catch(() => {}); // Swallow errors — never block the API response

    return updated;
  }
}
