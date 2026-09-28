import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { TokenService } from './token.service';
import { JwtStrategy } from '../strategies/jwt.strategy';

const config = new ConfigService({ JWT_SECRET: 'x'.repeat(40) });
const tokens = new TokenService(new JwtService({}), config);

describe('TokenService', () => {
  it('round-trips a token for its own purpose', () => {
    const t = tokens.sign('reset', { sub: 'u1', ver: 3 });
    expect(tokens.verify('reset', t)).toMatchObject({ sub: 'u1', ver: 3, typ: 'reset' });
  });

  it('rejects a token presented for a different purpose', () => {
    const reset = tokens.sign('reset', { sub: 'u1' });
    expect(() => tokens.verify('access', reset)).toThrow();
    expect(() => tokens.verify('refresh', reset)).toThrow();
  });

  it('derives a distinct signing key per purpose', () => {
    expect(tokens.keyFor('access')).not.toEqual(tokens.keyFor('refresh'));
  });
});

describe('JwtStrategy.validate', () => {
  const strategy = new JwtStrategy(tokens);
  const good = { typ: 'access', sub: 'u1', tenantId: 't1', role: 'ADMIN', email: 'a@b.c', name: 'A', employeeId: 'e1' };

  it('builds the principal from a valid access token', () => {
    expect(strategy.validate(good)).toEqual({ userId: 'u1', tenantId: 't1', role: 'ADMIN', email: 'a@b.c', name: 'A', employeeId: 'e1' });
  });

  it.each([
    ['wrong type', { ...good, typ: 'refresh' }],
    ['missing tenant', { ...good, tenantId: undefined }],
    ['empty tenant', { ...good, tenantId: '' }],
    ['unknown role', { ...good, role: 'ROOT' }],
  ])('fails closed on %s', (_label, payload) => {
    expect(() => strategy.validate(payload)).toThrow();
  });
});
