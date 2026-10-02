import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { TwoFactorAuthService } from './two-factor.service';
import { GoogleStrategy } from './strategies/google.strategy';
import { GoogleAuthGuard } from './google-auth.guard';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    TwoFactorAuthService,
    GoogleStrategy,
    GoogleAuthGuard,
  ],
  exports: [AuthService],
})
export class AuthModule {}
