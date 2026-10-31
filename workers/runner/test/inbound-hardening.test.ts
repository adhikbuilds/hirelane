import { describe, expect, it } from 'vitest';
import { htmlToText, parseEml } from '../src/tasks/inbound-mime';

describe('parser denial of service', () => {
  it('strips 1 MB of unclosed "<" in linear time', () => {
    const t0 = Date.now();
    const out = htmlToText('<'.repeat(1_000_000));
    expect(Date.now() - t0).toBeLessThan(1500);
    expect(out.length).toBeLessThan(1_000_001);
  });
  it('handles an unclosed <script> flood in linear time', () => {
    const t0 = Date.now();
    htmlToText('<script '.repeat(120_000));
    expect(Date.now() - t0).toBeLessThan(1500);
  });
  it('still converts ordinary html, drops script/style/head and decodes entities', () => {
    expect(htmlToText('<head><title>x</title></head><style>p{}</style><p>Hello &amp; <b>welcome</b></p><script>evil()</script><p>Bye</p>')).toBe('Hello & welcome\nBye');
  });
  it('parses a 1 MB html-only mail quickly', () => {
    const t0 = Date.now();
    const m = parseEml(`From: a@b.example.test\nContent-Type: text/html\n\n${'<a '.repeat(330_000)}`);
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(typeof m.text).toBe('string');
  });
});

describe('authentication headers', () => {
  it('exposes every Authentication-Results header, topmost first, and the envelope recipients separately from To', () => {
    const m = parseEml(
      'Authentication-Results: mx.ours.test; dmarc=pass header.from=x.test\nAuthentication-Results: mx.ours.test; dmarc=fail\nFrom: a@x.test\nDelivered-To: h+tag@apply.test\nTo: other@apply.test\nCc: cc@apply.test\n\nhi',
    );
    expect(m.authResults).toHaveLength(2);
    expect(m.authResults[0]).toContain('dmarc=pass');
    expect(m.envelopeTo).toEqual(['h+tag@apply.test']);
  });
  it('uses To as the envelope only when no Delivered-To exists, never Cc', () => {
    const m = parseEml('From: a@x.test\nTo: h+t@apply.test\nCc: cc@apply.test\n\nhi');
    expect(m.envelopeTo).toEqual(['h+t@apply.test']);
  });
});
