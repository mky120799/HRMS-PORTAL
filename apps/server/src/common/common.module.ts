import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TokenService } from './auth/token.service';
import { ReplayGuardService } from './auth/replay-guard.service';
import { SessionCacheService } from './auth/session-cache.service';
import { RolePermissionsService } from './auth/role-permissions.service';
import { RoleAssignmentService } from './auth/role-assignment.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { CryptoService } from './crypto/crypto.service';
import { StorageService } from './storage/storage.service';
import { TenantContextService } from './tenant/tenant-context.service';
import { EmailService } from './email/email.service';
import { EmailProcessor } from './email/email.processor';

/**
 * Cross-cutting infrastructure available to every feature module.
 * JwtModule is registered without a secret on purpose: TokenService always
 * passes the purpose-specific key explicitly.
 */
@Global()
@Module({
  imports: [PassportModule.register({ defaultStrategy: 'jwt' }), JwtModule.register({})],
  providers: [TokenService, ReplayGuardService, SessionCacheService, RolePermissionsService, RoleAssignmentService, JwtStrategy, CryptoService, StorageService, TenantContextService, EmailService, EmailProcessor],
  exports: [TokenService, ReplayGuardService, SessionCacheService, RolePermissionsService, RoleAssignmentService, CryptoService, StorageService, TenantContextService, EmailService],
})
export class CommonModule {}
