import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { ScimController } from './scim.controller';
import { TwoFactorAuthService } from './two-factor.service';
import { OidcAuthService } from './oidc-auth.service';
import { ScimService } from './scim.service';
import { ScimGroupsService } from './scim-groups.service';
import { SamlAuthService } from './saml-auth.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [AuthController, ScimController],
  providers: [
    AuthService,
    TwoFactorAuthService,
    OidcAuthService,
    ScimService,
    ScimGroupsService,
    SamlAuthService,
  ],
  exports: [AuthService],
})
export class AuthModule {}
