import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Sentry from '@sentry/nestjs';
import { EmailTemplates } from '../../common/email/templates';
import { PrismaService } from '../../common/prisma/prisma.service';
import { toDateOnly } from '../../common/utils/dates';
import { NotificationPublisherService } from '../notifications/notification-publisher.service';

const POLL_MS = 60 * 60_000;
const OPEN_RECORD_GRACE_MS = 10 * 60 * 60_000;

/** Queues idempotent reminders for attendance records missing a clock-out. */
@Injectable()
export class AttendanceScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AttendanceScheduler.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationPublisherService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => this.schedule(), POLL_MS);
    this.timer.unref();
    this.schedule();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private schedule() {
    void this.run().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Attendance reminder scheduler failed: ${message}`);
      Sentry.captureException(
        error instanceof Error ? error : new Error(message),
        { tags: { component: 'attendance-reminder-scheduler' } },
      );
    });
  }

  async run() {
    if (this.running) return;
    this.running = true;
    try {
      const cutoff = new Date(Date.now() - OPEN_RECORD_GRACE_MS);
      const records = await this.prisma.attendanceRecord.findMany({
        where: {
          clockOut: null,
          clockIn: { lt: cutoff },
          employee: { status: { not: 'EXITED' } },
        },
        include: {
          employee: {
            select: {
              firstName: true,
              lastName: true,
              email: true,
              userId: true,
            },
          },
        },
        orderBy: { clockIn: 'asc' },
        take: 50,
      });
      const frontendUrl = this.config.get('FRONTEND_URL', 'http://localhost:5173');
      for (const record of records) {
        const exists = await this.prisma.notificationEvent.count({
          where: {
            tenantId: record.tenantId,
            eventKey: `attendance-missing-clock-out:${record.id}`,
          },
        });
        if (exists) continue;
        const employeeName =
          `${record.employee.firstName} ${record.employee.lastName}`.trim();
        await this.prisma.$transaction(async (tx) => {
          await this.notifications.publish(tx, {
            tenantId: record.tenantId,
            eventKey: `attendance-missing-clock-out:${record.id}`,
            eventType: 'ATTENDANCE_MISSING_CLOCK_OUT',
            category: 'ATTENDANCE',
            data: {
              attendanceRecordId: record.id,
              date: toDateOnly(record.date),
            },
            recipients: [
              { userId: record.employee.userId, email: record.employee.email },
            ],
            channels: ['IN_APP', 'EMAIL'],
            title: 'Clock-out reminder',
            body: `Your attendance for ${toDateOnly(record.date)} is missing a clock-out.`,
            link: '/attendance',
            email: EmailTemplates.attendanceReminder({
              name: employeeName,
              date: toDateOnly(record.date),
              kind: 'MISSING_CLOCK_OUT',
              link: `${frontendUrl}/attendance`,
            }),
          });
        });
      }
    } finally {
      this.running = false;
    }
  }
}
