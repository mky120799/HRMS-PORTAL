import { BadRequestException, Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { OTP } from 'otplib';
import * as qrcode from 'qrcode';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';

const RECOVERY_CODE_COUNT = 10;
const TOTP_PERIOD_SECONDS = 30; // otplib default, matches authenticator apps
const RECOVERY_CODE_ROUNDS = 12;

const normalizeRecoveryCode = (code: string) =>
  code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

const displayRecoveryCode = () =>
  randomBytes(5).toString('hex').toUpperCase().replace(/^(.{5})(.{5})$/, '$1-$2');

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
    await this.prisma.user.update({ where: { id: user.id }, data: { twoFactorSecret: this.crypto.encrypt(secret), lastTotpStep: null } });
    return { qrCodeUrl: await qrcode.toDataURL(otpauthUrl) };
  }

  /**
   * Verifies a TOTP code and consumes its time step, so the same code (or an
   * older one) cannot be used twice — RFC 6238 §5.2. The conditional update makes
   * this hold under concurrency: of two requests with one code, only one wins.
   */
  async consumeCode(user: { id: string; twoFactorSecret: string | null }, code: string): Promise<boolean> {
    if (!user.twoFactorSecret || !/^\d{6}$/.test(code)) return false;
    const nowStep = Math.floor(Date.now() / 1000 / TOTP_PERIOD_SECONDS);
    const result = this.otp.verifySync({ token: code, secret: this.readSecret(user.twoFactorSecret) });
    if (!result.valid) return false;
    const step = nowStep + result.delta; // delta: matched step relative to now (clock drift window)
    const consumed = await this.prisma.user.updateMany({
      where: { id: user.id, OR: [{ lastTotpStep: null }, { lastTotpStep: { lt: step } }] },
      data: { lastTotpStep: step },
    });
    return consumed.count === 1;
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
    if (!(await this.consumeCode(user, code))) throw new BadRequestException('Invalid 2FA code');
    await this.prisma.user.update({ where: { id: user.id }, data: { isTwoFactorEnabled: true } });
  }

  async disable(user: { id: string; twoFactorSecret: string | null; isTwoFactorEnabled: boolean }, code: string) {
    if (!user.isTwoFactorEnabled) throw new BadRequestException('Two-factor authentication is not enabled');
    if (!(await this.consumeCode(user, code))) throw new BadRequestException('Invalid 2FA code');
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { isTwoFactorEnabled: false, twoFactorSecret: null, lastTotpStep: null } });
      await tx.mfaRecoveryCode.deleteMany({ where: { userId: user.id } });
    });
  }

  async generateRecoveryCodes(user: { id: string; tenantId: string }) {
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => displayRecoveryCode());
    const hashes = await Promise.all(
      codes.map((code) => bcrypt.hash(normalizeRecoveryCode(code), RECOVERY_CODE_ROUNDS)),
    );
    await this.prisma.$transaction(async (tx) => {
      await tx.mfaRecoveryCode.deleteMany({ where: { userId: user.id, usedAt: null } });
      await tx.mfaRecoveryCode.createMany({
        data: hashes.map((codeHash) => ({ tenantId: user.tenantId, userId: user.id, codeHash })),
      });
    });
    return codes;
  }

  async useRecoveryCode(userId: string, code: string): Promise<boolean> {
    const normalized = normalizeRecoveryCode(code);
    if (normalized.length < 8) return false;
    const candidates = await this.prisma.mfaRecoveryCode.findMany({
      where: { userId, usedAt: null },
      orderBy: { createdAt: 'asc' },
      take: RECOVERY_CODE_COUNT,
    });
    for (const candidate of candidates) {
      if (await bcrypt.compare(normalized, candidate.codeHash)) {
        // Conditional update: if a concurrent request consumed this code first, count is 0.
        const consumed = await this.prisma.mfaRecoveryCode.updateMany({
          where: { id: candidate.id, usedAt: null },
          data: { usedAt: new Date() },
        });
        return consumed.count === 1;
      }
    }
    return false;
  }

  unusedRecoveryCodeCount(userId: string) {
    return this.prisma.mfaRecoveryCode.count({ where: { userId, usedAt: null } });
  }
}
