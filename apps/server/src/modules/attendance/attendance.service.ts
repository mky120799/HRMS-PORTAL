import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class AttendanceService {
  constructor(private readonly prisma: PrismaService) {}

  async clockIn(tenantId: string, userId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Ensure employee exists in this tenant
    const employee = await this.prisma.employee.findFirst({
      where: { userId, tenantId },
    });
    if (!employee) {
      throw new NotFoundException('Employee not found for this user');
    }

    const existingRecord = await this.prisma.attendanceRecord.findUnique({
      where: {
        employeeId_date: {
          employeeId: employee.id,
          date: today,
        },
      },
    });

    if (existingRecord) {
      throw new BadRequestException('Already clocked in today');
    }

    return this.prisma.attendanceRecord.create({
      data: {
        tenantId,
        employeeId: employee.id,
        date: today,
        clockIn: new Date(),
        status: 'PRESENT',
      },
    });
  }

  async clockOut(tenantId: string, userId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const employee = await this.prisma.employee.findFirst({
      where: { userId, tenantId },
    });
    if (!employee) {
      throw new NotFoundException('Employee not found');
    }

    const record = await this.prisma.attendanceRecord.findUnique({
      where: {
        employeeId_date: {
          employeeId: employee.id,
          date: today,
        },
      },
    });

    if (!record) {
      throw new BadRequestException('Must clock in first');
    }
    if (record.clockOut) {
      throw new BadRequestException('Already clocked out today');
    }

    return this.prisma.attendanceRecord.update({
      where: { id: record.id },
      data: { clockOut: new Date() },
    });
  }

  async getMyAttendance(tenantId: string, userId: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { userId, tenantId },
    });
    if (!employee) {
      throw new NotFoundException('Employee not found');
    }

    return this.prisma.attendanceRecord.findMany({
      where: { tenantId, employeeId: employee.id },
      orderBy: { date: 'desc' },
      take: 30, // Last 30 days
    });
  }
}
