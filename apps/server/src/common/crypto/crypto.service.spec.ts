import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { CryptoService } from './crypto.service';

const crypto = new CryptoService(new ConfigService({ ENCRYPTION_KEY: randomBytes(32).toString('base64') }));

describe('CryptoService', () => {
  it('round-trips and uses a fresh IV each time', () => {
    const a = crypto.encrypt('JBSWY3DPEHPK3PXP');
    const b = crypto.encrypt('JBSWY3DPEHPK3PXP');
    expect(a).not.toEqual(b);
    expect(crypto.decrypt(a)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('detects tampering', () => {
    const [v, iv, tag, ct] = crypto.encrypt('secret').split('.');
    const flipped = Buffer.from(ct, 'base64url');
    flipped[0] ^= 1;
    expect(() => crypto.decrypt([v, iv, tag, flipped.toString('base64url')].join('.'))).toThrow();
  });
});

describe('legacy 2FA secrets', () => {
  it('verifies codes against both plaintext (legacy) and encrypted secrets', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { OTP } = require('otplib');
    const { TwoFactorAuthService } = require('../../modules/auth/two-factor.service');
    const otp = new OTP({ strategy: 'totp' });
    const secret = otp.generateSecret();
    const code = otp.generateSync({ secret });
    const svc = new TwoFactorAuthService({} as any, crypto);
    expect(svc.verifyCode(code, secret)).toBe(true);
    expect(svc.verifyCode(code, crypto.encrypt(secret))).toBe(true);
    expect(svc.verifyCode('000000', crypto.encrypt(secret))).toBe(otp.verifySync({ token: '000000', secret }).valid);
  });
});
