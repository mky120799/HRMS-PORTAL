import { BadRequestException, Injectable } from '@nestjs/common';
import { OTP } from 'otplib';
import * as qrcode from 'qrcode';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';

/**
 * TOTP (RFC 6238) second factor. The shared secret is encrypted at rest with
 * AES-256-GCM so a database leak alone does not expose users' 2FA seeds.
 */
@Injectable()
export class TwoFactorAuthService {
  private readonly otp = new OTP({ strategy: 'totp' });

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  /** Creates a new (not yet enabled) secret and returns a QR code for authenticator apps. */
  async beginEnrollment(user: { id: string; email: string; isTwoFactorEnabled: boolean }) {
    if (user.isTwoFactorEnabled) throw new BadRequestException('Two-factor authentication is already enabled');
    const secret = this.otp.generateSecret();
    const otpauthUrl = this.otp.generateURI({ issuer: process.env.APP_NAME || 'HRMS', label: user.email, secret });
    await this.prisma.user.update({ where: { id: user.id }, data: { twoFactorSecret: this.crypto.encrypt(secret) } });
    return { qrCodeUrl: await qrcode.toDataURL(otpauthUrl) };
  }

  verifyCode(code: string, storedSecret: string | null): boolean {
    if (!storedSecret) return false;
    return this.otp.verifySync({ token: code, secret: this.readSecret(storedSecret) }).valid;
  }

  /** Secrets created before encryption was introduced are plaintext base32 (no "v1." prefix). */
  private readSecret(stored: string): string {
    return stored.startsWith('v1.') ? this.crypto.decrypt(stored) : stored;
  }

  /** Re-encrypts a legacy plaintext secret after it has been used successfully. */
  async upgradeLegacySecret(userId: string, stored: string | null) {
    if (stored && !stored.startsWith('v1.')) {
      await this.prisma.user.update({ where: { id: userId }, data: { twoFactorSecret: this.crypto.encrypt(stored) } });
    }
  }

  async enable(user: { id: string; twoFactorSecret: string | null }, code: string) {
    if (!user.twoFactorSecret) throw new BadRequestException('Start 2FA setup first');
    if (!this.verifyCode(code, user.twoFactorSecret)) throw new BadRequestException('Invalid 2FA code');
    await this.prisma.user.update({ where: { id: user.id }, data: { isTwoFactorEnabled: true } });
  }

  async disable(user: { id: string; twoFactorSecret: string | null; isTwoFactorEnabled: boolean }, code: string) {
    if (!user.isTwoFactorEnabled) throw new BadRequestException('Two-factor authentication is not enabled');
    if (!this.verifyCode(code, user.twoFactorSecret)) throw new BadRequestException('Invalid 2FA code');
    await this.prisma.user.update({ where: { id: user.id }, data: { isTwoFactorEnabled: false, twoFactorSecret: null } });
  }
}
