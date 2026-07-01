import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './common/prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { EmployeesModule } from './modules/employees/employees.module';
import { LeavesModule } from './modules/leaves/leaves.module';
import { HiringModule } from './modules/hiring/hiring.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AttendanceModule } from './modules/attendance/attendance.module';
import { PayrollModule } from './modules/payroll/payroll.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.get('REDIS_HOST', 'localhost'),
          port: configService.get('REDIS_PORT', 6379),
        },
      }),
    }),
    PrismaModule,
    AuthModule,
    EmployeesModule,
    LeavesModule,
    HiringModule,
    TenantsModule,
    NotificationsModule,
    AttendanceModule,
    PayrollModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
