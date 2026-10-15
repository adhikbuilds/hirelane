/**
 * Employer HTML (or markdown that may contain HTML) to safe markdown.
 *
 * Two stages: sanitize-html with a small allowlist, then a streaming conversion of that already-clean markup.
 * The output is markdown text only. It never contains a tag: stray angle brackets are backslash-escaped.
 */
import sanitizeHtml from "sanitize-html";
import { Parser } from "htmlparser2";

const ALLOWED_TAGS = [
  "p", "br", "hr", "ul", "ol", "li", "strong", "b", "em", "i", "code", "pre", "blockquote", "a",
  "h1", "h2", "h3", "h4", "h5", "h6", "div", "span",
];

const SANITIZE: sanitizeHtml.IOptions = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: { a: ["href"] },
  allowedSchemes: ["http", "https", "mailto"],
  allowProtocolRelative: false,
  disallowedTagsMode: "discard",
  // Contents of these are dropped, not just the tag (sanitize-html defaults plus embedded content).
  nonTextTags: ["script", "style", "textarea", "option", "noscript", "iframe", "svg", "object", "template"],
};

const SAFE_HREF = /^(https?:\/\/|mailto:)/i;
const BLOCK = new Set(["p", "div", "blockquote", "ul", "ol", "h1", "h2", "h3", "h4", "h5", "h6", "pre", "hr"]);

export type MarkdownOptions = { maxChars?: number };

export function htmlToMarkdown(input: string | null | undefined, opts: MarkdownOptions = {}): string {
  if (!input || !input.trim()) return "";
  // Input with no markup at all is already markdown (description_md): keep its line structure, only neutralise "<".
  if (!/<[a-z!/?]/i.test(input)) return finish(safeMarkdown(input.replace(/\r\n?/g, "\n").replace(/</g, "\\<")), opts.maxChars);
  const clean = sanitizeHtml(input, SANITIZE);

  let out = "";
  const lists: { ordered: boolean; n: number }[] = [];
  const links: (string | null)[] = [];
  let inPre = 0;
  let depthCap = 0;

  const blank = () => {
    if (out.length === 0) return;
    out = out.replace(/[ \t]+$/, "");
    if (!out.endsWith("\n\n")) out += out.endsWith("\n") ? "\n" : "\n\n";
  };

  const parser = new Parser(
    {
      onopentag(name, attrs) {
        if (BLOCK.has(name) && name !== "hr") {
          if (name !== "ul" && name !== "ol") blank();
          else if (lists.length === 0) blank();
          else if (!out.endsWith("\n")) out += "\n";
        }
        switch (name) {
          case "h1": case "h2": case "h3": case "h4": case "h5": case "h6":
            out += "#".repeat(Number(name[1])) + " ";
            break;
          case "ul": case "ol": lists.push({ ordered: name === "ol", n: 0 }); break;
          case "li": {
            const l = lists[lists.length - 1] ?? { ordered: false, n: 0 };
            l.n += 1;
            if (out.length > 0 && !out.endsWith("\n")) out += "\n";
            out += "  ".repeat(Math.max(0, lists.length - 1)) + (l.ordered ? `${l.n}. ` : "- ");
            break;
          }
          case "strong": case "b": out += "**"; break;
          case "em": case "i": out += "*"; break;
          case "code": if (!inPre) out += "`"; break;
          case "pre": out += "```\n"; inPre += 1; break;
          case "blockquote": out += "> "; break;
          case "hr": blank(); out += "---"; blank(); break;
          case "br": out += inPre ? "\n" : "  \n"; break;
          case "a": {
            const href = attrs["href"];
            const ok = typeof href === "string" && SAFE_HREF.test(href.trim());
            links.push(ok ? href!.trim().replace(/\(/g, "%28").replace(/\)/g, "%29").replace(/\s/g, "%20") : null);
            if (ok) out += "[";
            break;
          }
        }
        depthCap += 1;
      },
      ontext(text) {
        const t = inPre ? text : text.replace(/\s+/g, " ");
        // "[" and "]" are escaped so employer text cannot assemble a markdown link of its own.
        const s = t.replace(/[<[\]]/g, (c) => `\\${c}`);
        if (!inPre && (out.length === 0 || out.endsWith("\n") || out.endsWith("> ")) && s.startsWith(" ")) out += s.slice(1);
        else out += s;
      },
      onclosetag(name) {
        depthCap -= 1;
        switch (name) {
          case "strong": case "b": out += "**"; break;
          case "em": case "i": out += "*"; break;
          case "code": if (!inPre) out += "`"; break;
          case "pre":
            inPre = Math.max(0, inPre - 1);
            if (!out.endsWith("\n")) out += "\n";
            out += "```";
            break;
          case "a": {
            const href = links.pop();
            if (href) out += `](${href})`;
            break;
          }
          case "ul": case "ol": lists.pop(); break;
        }
        if (BLOCK.has(name) && name !== "hr") {
          if ((name === "ul" || name === "ol") && lists.length > 0) {
            if (!out.endsWith("\n")) out += "\n";
          } else blank();
        } else if (name === "li") {
          if (!out.endsWith("\n")) out += "\n";
        }
      },
    },
    { decodeEntities: true },
  );
  parser.write(clean);
  parser.end();

  return finish(out, opts.maxChars);
}

/** Link and image targets in markdown input: keep http(s) and mailto links, reduce everything else to its text. */
function safeMarkdown(text: string): string {
  return text
    .replace(/(!?)\[([^\]\n]*)\]\(\s*([^)\s]*)[^)\n]*\)/g, (_m, bang: string, label: string, target: string) =>
      !bang && SAFE_HREF.test(target) ? `[${label}](${target})` : label,
    )
    .replace(/^[ \t]*\[[^\]\n]+\]:.*$/gm, "");
}

function finish(text: string, max: number | undefined): string {
  let md = text
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (max !== undefined && md.length > max) {
    const cut = md.slice(0, max);
    const sp = cut.lastIndexOf(" ");
    md = (sp > max * 0.8 ? cut.slice(0, sp) : cut).trimEnd() + "…";
  }
  return md;
}
