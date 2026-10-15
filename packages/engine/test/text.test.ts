import { describe, expect, it } from 'vitest';
import { DOC_FORMAT_VERSION } from '../src/version';
import { decodeEntities, docFromText, fnv1a64, toDoc } from '../src/text';

describe('fnv1a64', () => {
  it('matches the published FNV-1a 64 vectors', () => {
    expect(fnv1a64('')).toBe('cbf29ce484222325');
    expect(fnv1a64('a')).toBe('af63dc4c8601ec8c');
    expect(fnv1a64('foobar')).toBe('85944171f73967e8');
  });
  it('hashes non-ASCII via UTF-8 and is always 16 lowercase hex', () => {
    expect(fnv1a64('₹18 LPA')).toMatch(/^[0-9a-f]{16}$/);
    expect(fnv1a64('😀')).toMatch(/^[0-9a-f]{16}$/);
    expect(fnv1a64('a')).not.toBe(fnv1a64('b'));
  });
});

describe('decodeEntities', () => {
  it('decodes named, decimal and hex entities in one pass', () => {
    expect(decodeEntities('R&amp;D &lt;b&gt; &quot;x&quot; &#39;y&#39; &#x20B9; &mdash; &rsquo;')).toBe('R&D <b> "x" \'y\' ₹ — ’');
  });
  it('does not double-decode and leaves unknown entities alone', () => {
    expect(decodeEntities('&amp;lt;')).toBe('&lt;');
    expect(decodeEntities('&bogus; &#xZZ;')).toBe('&bogus; &#xZZ;');
  });
  it('maps nbsp to U+00A0', () => expect(decodeEntities('a&nbsp;b')).toBe('a b'));
});

describe('toDoc', () => {
  it('returns an empty doc for null and empty html', () => {
    for (const h of [null, '', '   ']) {
      const d = toDoc(h);
      expect(d.text).toBe('');
      expect(d.blocks).toEqual([]);
      expect(d.format).toBe(DOC_FORMAT_VERSION);
      expect(d.hash).toBe(fnv1a64(''));
    }
  });
  it('turns paragraphs, headings and bullets into blocks whose offsets slice the text', () => {
    const d = toDoc('<h2>What you\'ll do</h2><p>Build things.</p><ul><li>One</li><li>Two <b>bold</b></li></ul><h3>Nice to have</h3><ul><li>Three</li></ul>');
    const kinds = d.blocks.map((b) => b.kind);
    expect(kinds).toEqual(['heading', 'paragraph', 'bullet', 'bullet', 'heading', 'bullet']);
    expect(d.blocks.map((b) => d.text.slice(b.start, b.end))).toEqual(["What you'll do", 'Build things.', 'One', 'Two bold', 'Nice to have', 'Three']);
    expect(d.blocks[0]).toMatchObject({ level: 2, ruleId: 'text.heading.h2' });
    expect(d.blocks[2]).toMatchObject({ level: 1 });
  });
  it('separates blocks with a newline, and with a blank line before a heading', () => {
    const d = toDoc('<p>a</p><p>b</p><h2>H</h2><p>c</p>');
    expect(d.text).toBe('a\nb\n\nH\nc');
  });
  it('decodes entities once while stripping tags (R&amp;D -> R&D)', () => {
    const d = toDoc('<p>Our R&amp;D team&nbsp;rocks</p>');
    expect(d.text).toBe('Our R&D team rocks');
  });
  it('treats a bold-only paragraph as a level 4 heading', () => {
    const d = toDoc('<p><strong>Requirements</strong></p><ul><li>Python</li></ul>');
    expect(d.blocks[0]).toMatchObject({ kind: 'heading', level: 4, ruleId: 'text.heading.bold_line' });
  });
  it('treats a short line ending with a colon as a level 5 heading', () => {
    const d = toDoc('<p>What we offer:</p><p>This is a long sentence that happens to end with a colon but is far too long to be a heading at all:</p>');
    expect(d.blocks[0]).toMatchObject({ kind: 'heading', level: 5, ruleId: 'text.heading.colon_line' });
    expect(d.blocks[1]!.kind).toBe('paragraph');
  });
  it('handles Greenhouse style li > p nesting as a single bullet', () => {
    const d = toDoc('<ul><li><p>First point</p></li><li><p>Second point</p></li></ul>');
    expect(d.blocks.map((b) => b.kind)).toEqual(['bullet', 'bullet']);
    expect(d.blocks.map((b) => d.text.slice(b.start, b.end))).toEqual(['First point', 'Second point']);
  });
  it('tracks nested list depth', () => {
    const d = toDoc('<ul><li>Outer<ul><li>Inner</li></ul></li></ul>');
    expect(d.blocks.map((b) => [d.text.slice(b.start, b.end), b.level])).toEqual([['Outer', 1], ['Inner', 2]]);
  });
  it('splits on <br> and drops script and style content', () => {
    const d = toDoc('<p>one<br>two</p><script>alert(1)</script><style>p{}</style><p>three</p>');
    expect(d.text).toBe('one\ntwo\nthree');
  });
  it('collapses whitespace and normalises to NFC', () => {
    const d = toDoc('<p>  a \n\t  b  </p><p>é</p>');
    expect(d.text).toBe('a b\né');
  });
  it('produces a Lever style heading plus bullets', () => {
    const d = toDoc('<h3>Requirements</h3><li>Go</li><li>SQL</li>');
    expect(d.blocks.map((b) => b.kind)).toEqual(['heading', 'bullet', 'bullet']);
  });
  it('is deterministic and hash tracks the text', () => {
    const h = '<p>x</p><ul><li>y</li></ul>';
    expect(toDoc(h)).toStrictEqual(toDoc(h));
    expect(toDoc(h).hash).toBe(fnv1a64(toDoc(h).text));
    expect(toDoc('<p>x</p>').hash).not.toBe(toDoc('<p>z</p>').hash);
  });
  it('round-trips through JSON', () => {
    const d = toDoc('<h2>A</h2><ul><li>b</li></ul>');
    expect(JSON.parse(JSON.stringify(d))).toStrictEqual(d);
  });
  it('handles unclosed tags, comments and attributes', () => {
    const d = toDoc('<!-- c --><p class="x" data-a=">">hello<li>item');
    expect(d.text).toContain('hello');
    expect(d.text).toContain('item');
  });
  it('blocks never overlap and stay in order', () => {
    const d = toDoc('<h1>T</h1><p>a</p><ul><li>b</li><li>c<ul><li>d</li></ul></li></ul><p>e</p>');
    for (let i = 1; i < d.blocks.length; i++) expect(d.blocks[i]!.start).toBeGreaterThanOrEqual(d.blocks[i - 1]!.end);
  });
});

describe('docFromText', () => {
  it('makes each non-empty line a paragraph block', () => {
    const d = docFromText('Hello\n\nWorld');
    expect(d.text).toBe('Hello\nWorld');
    expect(d.blocks.map((b) => b.kind)).toEqual(['paragraph', 'paragraph']);
    expect(d.blocks.map((b) => d.text.slice(b.start, b.end))).toEqual(['Hello', 'World']);
  });
  it('handles empty input', () => {
    expect(docFromText('').blocks).toEqual([]);
    expect(docFromText('').text).toBe('');
  });
});
