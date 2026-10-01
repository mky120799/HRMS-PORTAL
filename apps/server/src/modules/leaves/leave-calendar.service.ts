import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { countWorkingDays, parseDateOnly, toDateOnly } from '../../common/utils/dates';

@Injectable()
export class LeaveCalendarService {
  constructor(private readonly prisma: PrismaService) {}

  listHolidays(tenantId: string, year: number) {
    return this.prisma.holiday.findMany({
      where: { tenantId, date: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) } },
      orderBy: { date: 'asc' },
    });
  }

  addHoliday(tenantId: string, dto: { date: string; name: string }) {
    return this.prisma.holiday.create({ data: { tenantId, date: parseDateOnly(dto.date), name: dto.name } });
  }

  async removeHoliday(tenantId: string, id: string) {
    const { count } = await this.prisma.holiday.deleteMany({ where: { id, tenantId } });
    if (!count) throw new NotFoundException('Holiday not found');
    return { deleted: true };
  }

  workingDays(tenantId: string, start: Date, end: Date) {
    return this.workingDaysWith(this.prisma, tenantId, start, end);
  }

  async workingDaysWith(db: Prisma.TransactionClient | PrismaService, tenantId: string, start: Date, end: Date): Promise<number> {
    const holidays = await db.holiday.findMany({ where: { tenantId, date: { gte: start, lte: end } }, select: { date: true } });
    return countWorkingDays(start, end, new Set(holidays.map((holiday) => toDateOnly(holiday.date))));
  }
}
