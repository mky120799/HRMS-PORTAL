import * as bcrypt from 'bcryptjs';
import { OTP } from 'otplib';
import { TwoFactorAuthService } from './two-factor.service';

describe('TwoFactorAuthService recovery codes', () => {
  const hash = bcrypt.hashSync('ABCDE12345', 4);
  const findMany = jest.fn();
  const updateMany = jest.fn();
  const prisma = { mfaRecoveryCode: { findMany, updateMany } } as any;
  const service = new TwoFactorAuthService(prisma, {} as any);

  beforeEach(() => {
    findMany.mockResolvedValue([{ id: 'c1', codeHash: hash }]);
    updateMany.mockReset();
  });

  it('accepts a matching code once, consuming it with a conditional update', async () => {
    updateMany.mockResolvedValue({ count: 1 });
    await expect(service.useRecoveryCode('u1', 'abcde-12345')).resolves.toBe(true);
    expect(updateMany).toHaveBeenCalledWith({ where: { id: 'c1', usedAt: null }, data: { usedAt: expect.any(Date) } });
  });

  it('rejects the code when a concurrent request consumed it first', async () => {
    updateMany.mockResolvedValue({ count: 0 });
    await expect(service.useRecoveryCode('u1', 'ABCDE-12345')).resolves.toBe(false);
  });

  it('rejects wrong and too-short codes', async () => {
    await expect(service.useRecoveryCode('u1', 'ZZZZZ-99999')).resolves.toBe(false);
    await expect(service.useRecoveryCode('u1', '123')).resolves.toBe(false);
    expect(updateMany).not.toHaveBeenCalled();
  });
});

describe('TwoFactorAuthService TOTP replay protection', () => {
  const otp = new OTP({ strategy: 'totp' });
  const secret = otp.generateSecret(); // legacy plaintext form: no decryption needed
  const updateMany = jest.fn();
  const service = new TwoFactorAuthService({ user: { updateMany } } as any, {} as any);
  const user = { id: 'u1', twoFactorSecret: secret };

  beforeEach(() => updateMany.mockReset());

  it('accepts a valid code once by consuming its time step conditionally', async () => {
    updateMany.mockResolvedValue({ count: 1 });
    await expect(service.consumeCode(user, otp.generateSync({ secret }))).resolves.toBe(true);
    const step = Math.floor(Date.now() / 30_000);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'u1', OR: [{ lastTotpStep: null }, { lastTotpStep: { lt: expect.any(Number) } }] },
      data: { lastTotpStep: expect.any(Number) },
    });
    expect(Math.abs(updateMany.mock.calls[0][0].data.lastTotpStep - step)).toBeLessThanOrEqual(1);
  });

  it('rejects a code whose step was already used (count 0)', async () => {
    updateMany.mockResolvedValue({ count: 0 });
    await expect(service.consumeCode(user, otp.generateSync({ secret }))).resolves.toBe(false);
  });

  it('rejects wrong or malformed codes without touching the database', async () => {
    await expect(service.consumeCode(user, '12345')).resolves.toBe(false);
    await expect(service.consumeCode({ id: 'u1', twoFactorSecret: null }, '123456')).resolves.toBe(false);
    expect(updateMany).not.toHaveBeenCalled();
  });
});
