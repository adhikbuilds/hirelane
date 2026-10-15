import { describe, expect, it } from 'vitest';
import { isPublicIp } from '../src/company/ip';

describe('isPublicIp', () => {
  it.each(['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.15.0.1', '172.32.0.1', '2606:4700:4700::1111', '100.63.0.1', '100.128.0.1'])(
    'accepts public %s',
    (ip) => expect(isPublicIp(ip)).toBe(true),
  );
  it.each([
    '0.0.0.0',
    '10.0.0.1',
    '127.0.0.1',
    '127.255.255.254',
    '169.254.169.254',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '100.64.0.1',
    '100.127.255.255',
    '224.0.0.1',
    '255.255.255.255',
    '192.0.0.1',
    '198.18.0.1',
    '::',
    '::1',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    'ff02::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:10.0.0.1',
    '64:ff9b::7f00:1',
  ])('rejects non-public %s', (ip) => expect(isPublicIp(ip)).toBe(false));
  it.each(['', 'not-an-ip', '999.1.1.1', '1.2.3', '1.2.3.4.5', '08.8.8.8', '1e3.0.0.1'])('rejects malformed %j', (ip) =>
    expect(isPublicIp(ip)).toBe(false),
  );
});
