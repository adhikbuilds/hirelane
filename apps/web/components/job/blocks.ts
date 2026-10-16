export type DescBlock =
  | { kind: "p"; text: string }
  | { kind: "h"; text: string }
  | { kind: "ul"; items: string[] };

const BULLET = /^\s*(?:[-*•‣◦⁃∙]|\d{1,2}[.)])\s+(.*\S)\s*$/;

/** A short line that introduces what follows: "Responsibilities:", "You will...", "About you…". */
const HEADING = /^(.{1,60}?)\s*(?::|\.{3}|…)$/;
/** A line that ends a sentence or a thought; the next line starts a new paragraph rather than continuing it. */
const ENDS_THOUGHT = /[.!?:;…)"”’]$/;

/**
 * Turns the plain-text description into renderable blocks. Everything stays text (React escapes it), so there is
 * nothing to sanitise at render time: no HTML is ever interpreted.
 * - a short line ending in ":" or "..." on its own becomes a heading
 * - bullet lines ("-", "*", "•", "1.") become a list, and so do two or more plain lines straight after a heading
 * - a line continues the previous paragraph only when it looks soft-wrapped (no closing punctuation, lowercase start);
 *   otherwise each source line is its own paragraph, because ATS text keeps one line per HTML block
 */
export function describe(text: string | null | undefined): DescBlock[] {
  if (!text) return [];
  const blocks: DescBlock[] = [];
  for (const chunk of text.replace(/\r\n?/g, "\n").split(/\n\s*\n/)) {
    const lines = chunk.split("\n").map((l) => l.trim()).filter(Boolean);
    let afterHeading = false;
    let plain: string[] = [];
    let list: string[] = [];
    const flushPlain = () => {
      if (afterHeading && plain.length >= 2) blocks.push({ kind: "ul", items: plain });
      else {
        const paras: string[] = [];
        for (const l of plain) {
          const prev = paras.length - 1;
          if (prev >= 0 && !ENDS_THOUGHT.test(paras[prev]!) && /^[a-z(]/.test(l)) paras[prev] += ` ${l}`;
          else paras.push(l);
        }
        for (const t of paras) blocks.push({ kind: "p", text: t });
      }
      plain = [];
    };
    const flushList = () => {
      if (list.length) blocks.push({ kind: "ul", items: list });
      list = [];
    };
    for (const line of lines) {
      const b = BULLET.exec(line);
      if (b) {
        flushPlain();
        list.push(b[1]!);
        continue;
      }
      flushList();
      const h = HEADING.exec(line);
      if (h && plain.length === 0) {
        blocks.push({ kind: "h", text: h[1]! });
        afterHeading = true;
        continue;
      }
      plain.push(line);
    }
    flushPlain();
    flushList();
  }
  return blocks;
}
