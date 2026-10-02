import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { validateEnv } from './config/env';
import { PrismaModule } from './common/prisma/prisma.module';
import { CommonModule } from './common/common.module';
import { AuditModule } from './common/audit/audit.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { TenantAccessGuard } from './common/guards/tenant-access.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { StepUpGuard } from './common/guards/step-up.guard';
import { SubscriptionGuard } from './common/guards/subscription.guard';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { AuditInterceptor } from './common/audit/audit.interceptor';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { EmployeesModule } from './modules/employees/employees.module';
import { LeavesModule } from './modules/leaves/leaves.module';
import { AttendanceModule } from './modules/attendance/attendance.module';
import { PayrollModule } from './modules/payroll/payroll.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { PerformanceModule } from './modules/performance/performance.module';
import { HiringModule } from './modules/hiring/hiring.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AiModule } from './modules/ai/ai.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { BillingModule } from './modules/stripe/stripe.module';
import { GdprModule } from './modules/compliance/gdpr.module';
import { PlatformModule } from './modules/platform/platform.module';
import { RolesModule } from './modules/roles/roles.module';
import { RabbitMqModule } from './common/messaging/rabbitmq.module';
import { RateLimitModule } from './common/rate-limit/rate-limit.module';
import { RateLimitStorage } from './common/rate-limit/rate-limit.storage';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv, cache: true, envFilePath: ['.env', '../../.env'] }),
    // Default: 100 requests/minute per client IP. Sensitive routes override with @Throttle().
    // Counters live in Redis so every API instance shares them (in memory without REDIS_URL).
    RateLimitModule,
    ThrottlerModule.forRootAsync({
      inject: [RateLimitStorage],
      useFactory: (storage: RateLimitStorage) => ({ throttlers: [{ ttl: 60_000, limit: 100 }], storage }),
    }),
    RabbitMqModule,
    PrismaModule,
    CommonModule,
    AuditModule,
    HealthModule,
    AuthModule,
    TenantsModule,
    EmployeesModule,
    LeavesModule,
    AttendanceModule,
    PayrollModule,
    DocumentsModule,
    PerformanceModule,
    HiringModule,
    NotificationsModule,
    AiModule,
    AnalyticsModule,
    BillingModule,
    GdprModule,
    PlatformModule,
    RolesModule,
  ],
  providers: [
    // Guard order matters — each guard relies on the previous one:
    // rate limit → authenticate → tenant checks (suspension, IP allow-list) → role → permission → step-up → plan
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: TenantAccessGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: StepUpGuard },
    { provide: APP_GUARD, useClass: SubscriptionGuard },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
  ],
})
export class AppModule {}
