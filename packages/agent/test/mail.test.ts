import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createFileOutbox } from '../src/mail/file-outbox.js';
import { createMailer } from '../src/mail/factory.js';
import { renderCodeEmail } from '../src/mail/templates/code.js';

const dirs: string[] = [];
async function tmp(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'hl-outbox-'));
  dirs.push(d);
  return d;
}
afterEach(async () => {
  while (dirs.length) await rm(dirs.pop()!, { recursive: true, force: true });
});

describe('code email template', () => {
  it('includes the code and the lifetime, in plain text', () => {
    const m = renderCodeEmail({ code: '123456', purpose: 'login', ttlMinutes: 10 });
    expect(m.text).toContain('123456');
    expect(m.text).toContain('10 minutes');
    expect(m.subject.length).toBeGreaterThan(0);
  });

  it('keeps the code out of the subject so it is not shown in notifications logs', () => {
    expect(renderCodeEmail({ code: '654321', purpose: 'login', ttlMinutes: 10 }).subject).not.toContain('654321');
  });

  it('has a distinct subject for campus email proof', () => {
    const a = renderCodeEmail({ code: '111111', purpose: 'login', ttlMinutes: 10 });
    const b = renderCodeEmail({ code: '111111', purpose: 'campus_email', ttlMinutes: 10 });
    expect(a.subject).not.toBe(b.subject);
  });

  it('rejects anything that is not exactly six digits', () => {
    for (const bad of ['12345', '1234567', 'abcdef', '12 456', '']) {
      expect(() => renderCodeEmail({ code: bad, purpose: 'login', ttlMinutes: 10 })).toThrow();
    }
  });
});

describe('file outbox mailer', () => {
  it('writes one .eml per message with the headers and body', async () => {
    const dir = await tmp();
    const mailer = createFileOutbox({ dir });
    const { id } = await mailer.send({ to: 'student@example.test', subject: 'Hello', text: 'Body line' });
    const files = await readdir(dir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/\.eml$/);
    expect(files[0]).toContain(id);
    const eml = await readFile(join(dir, files[0]!), 'utf8');
    expect(eml).toContain('To: student@example.test');
    expect(eml).toContain('Subject: Hello');
    expect(eml).toContain('Content-Type: text/plain; charset=utf-8');
    expect(eml).toContain('Body line');
  });

  it('creates the directory and keeps files private to the owner', async () => {
    const dir = join(await tmp(), 'nested', 'outbox');
    await createFileOutbox({ dir }).send({ to: 'a@example.test', subject: 's', text: 't' });
    const files = await readdir(dir);
    const mode = (await stat(join(dir, files[0]!))).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('does not overwrite: two messages make two files', async () => {
    const dir = await tmp();
    const m = createFileOutbox({ dir });
    await m.send({ to: 'a@example.test', subject: 's', text: 't' });
    await m.send({ to: 'a@example.test', subject: 's', text: 't' });
    expect(await readdir(dir)).toHaveLength(2);
  });

  it('refuses header injection through to or subject', async () => {
    const m = createFileOutbox({ dir: await tmp() });
    await expect(m.send({ to: 'a@example.test\r\nBcc: x@example.test', subject: 's', text: 't' })).rejects.toThrow();
    await expect(m.send({ to: 'a@example.test', subject: 's\nBcc: x@example.test', text: 't' })).rejects.toThrow();
  });

  it('refuses an address that is not a single mailbox', async () => {
    const m = createFileOutbox({ dir: await tmp() });
    for (const to of ['', 'no-at-sign', 'a@b.test, c@d.test', 'a b@c.test']) {
      await expect(m.send({ to, subject: 's', text: 't' }), to).rejects.toThrow();
    }
  });

  it('refuses to write in production', async () => {
    const m = createFileOutbox({ dir: await tmp(), env: { NODE_ENV: 'production' } });
    await expect(m.send({ to: 'a@example.test', subject: 's', text: 't' })).rejects.toThrow(/production/);
  });

  it('never prints the address or body', async () => {
    const seen: string[] = [];
    const orig = [console.log, console.error, console.warn, console.info];
    console.log = console.error = console.warn = console.info = (...a: unknown[]) => void seen.push(a.join(' '));
    try {
      await createFileOutbox({ dir: await tmp() }).send({ to: 'quiet@example.test', subject: 's', text: 'code 424242' });
    } finally {
      [console.log, console.error, console.warn, console.info] = orig as [typeof console.log, typeof console.error, typeof console.warn, typeof console.info];
    }
    expect(seen.join('\n')).not.toContain('quiet@example.test');
    expect(seen.join('\n')).not.toContain('424242');
  });
});

describe('createMailer', () => {
  it('builds the file outbox outside production', async () => {
    const d = await tmp();
    const m = createMailer({ env: { NODE_ENV: 'development' }, dir: d });
    await m.send({ to: 'a@example.test', subject: 'hi', text: 'x' });
    expect((await readdir(d)).length).toBe(1);
  });
  it('refuses to construct the file outbox in production, so a missing transport is caught before the first send', () => {
    expect(() => createMailer({ env: { NODE_ENV: 'production' } })).toThrow(/transport/);
  });
  it('in production uses an injected real transport', async () => {
    const sent: string[] = [];
    const m = createMailer({ env: { NODE_ENV: 'production' }, transport: { send: async (x) => (sent.push(x.to), { id: '1' }) } });
    await m.send({ to: 'a@example.test', subject: 's', text: 't' });
    expect(sent).toEqual(['a@example.test']);
  });
});
