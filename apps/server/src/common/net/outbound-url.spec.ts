import { assertOutboundUrl, isPrivateAddress } from './outbound-url';

describe('outbound URL guard', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    'fd00::1',
    'fe80::1',
    '::ffff:10.0.0.1',
  ])('treats %s as private', (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each(['8.8.8.8', '172.32.0.1', '2606:4700:4700::1111'])('treats %s as public', (address) => {
    expect(isPrivateAddress(address)).toBe(false);
  });

  const strict = { allowPrivate: false, requireHttps: true };

  it('rejects metadata and loopback addresses', async () => {
    await expect(assertOutboundUrl('https://169.254.169.254/latest', strict)).rejects.toThrow(/private/);
    await expect(assertOutboundUrl('https://[::1]/x', strict)).rejects.toThrow(/private/);
  });

  it('rejects http when https is required, and embedded credentials', async () => {
    await expect(assertOutboundUrl('http://8.8.8.8/', strict)).rejects.toThrow(/https/);
    await expect(assertOutboundUrl('https://user:pw@8.8.8.8/', strict)).rejects.toThrow(/credentials/);
  });

  it('allows public IPs, and private ones only when explicitly enabled', async () => {
    await expect(assertOutboundUrl('https://8.8.8.8/', strict)).resolves.toBeInstanceOf(URL);
    await expect(assertOutboundUrl('http://localhost:8080/realms/x', { allowPrivate: true, requireHttps: false })).resolves.toBeInstanceOf(URL);
  });
});
