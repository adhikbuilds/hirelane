import { describe, expect, it } from 'vitest';
import { createGuardedFetch } from '../src/company/transport';

describe('createGuardedFetch (connect-time DNS pin)', () => {
  it('refuses to connect when the connect-time lookup returns a private address', async () => {
    const f = createGuardedFetch(async () => ['127.0.0.1']);
    await expect(f('https://acme.com/x', { redirect: 'manual', signal: new AbortController().signal, headers: {} })).rejects.toThrow(/private_ip/);
  });
  it('refuses when any returned address is private or none returned', async () => {
    const ac = new AbortController();
    await expect(createGuardedFetch(async () => ['8.8.8.8', '10.0.0.1'])('https://acme.com/x', { redirect: 'manual', signal: ac.signal, headers: {} })).rejects.toThrow();
    await expect(createGuardedFetch(async () => [])('https://acme.com/x', { redirect: 'manual', signal: ac.signal, headers: {} })).rejects.toThrow();
  });
  it('rejects non-https URLs', async () => {
    const f = createGuardedFetch(async () => ['8.8.8.8']);
    await expect(f('http://acme.com/x', { redirect: 'manual', signal: new AbortController().signal, headers: {} })).rejects.toThrow(/https/);
  });
});
