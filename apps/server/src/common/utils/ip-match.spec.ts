import { ipMatchesAny, isValidIpRule } from './ip-match';

describe('ip allow-list matching', () => {
  it('matches exact addresses and CIDR ranges', () => {
    expect(ipMatchesAny('203.0.113.7', ['203.0.113.7'])).toBe(true);
    expect(ipMatchesAny('203.0.113.7', ['203.0.113.0/24'])).toBe(true);
    expect(ipMatchesAny('203.0.114.7', ['203.0.113.0/24'])).toBe(false);
    expect(ipMatchesAny('10.1.2.3', ['0.0.0.0/0'])).toBe(true);
  });

  it('normalises IPv4-mapped IPv6 addresses', () => {
    expect(ipMatchesAny('::ffff:203.0.113.7', ['203.0.113.0/24'])).toBe(true);
  });

  it('validates rules', () => {
    expect(isValidIpRule('10.0.0.0/8')).toBe(true);
    expect(isValidIpRule('2001:db8::1')).toBe(true);
    expect(isValidIpRule('10.0.0.0/33')).toBe(false);
    expect(isValidIpRule('not-an-ip')).toBe(false);
  });
});
