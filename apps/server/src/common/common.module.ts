import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { BullModule } from '@nestjs/bullmq';
import { TokenService } from './auth/token.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { CryptoService } from './crypto/crypto.service';
import { StorageService } from './storage/storage.service';
import { TenantContextService } from './tenant/tenant-context.service';
import { EmailService, EMAIL_QUEUE } from './email/email.service';
import { EmailProcessor } from './email/email.processor';

/**
 * Cross-cutting infrastructure available to every feature module.
 * JwtModule is registered without a secret on purpose: TokenService always
 * passes the purpose-specific key explicitly.
 */
@Global()
@Module({
  imports: [PassportModule.register({ defaultStrategy: 'jwt' }), JwtModule.register({}), BullModule.registerQueue({ name: EMAIL_QUEUE })],
  providers: [TokenService, JwtStrategy, CryptoService, StorageService, TenantContextService, EmailService, EmailProcessor],
  exports: [TokenService, CryptoService, StorageService, TenantContextService, EmailService, BullModule],
})
export class CommonModule {}
