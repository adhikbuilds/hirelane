import { describe, expect, it } from "vitest";
import { htmlToMarkdown } from "../lib/markdown";

describe("htmlToMarkdown", () => {
  it("returns empty string for null, undefined and blank input", () => {
    expect(htmlToMarkdown(null)).toBe("");
    expect(htmlToMarkdown(undefined)).toBe("");
    expect(htmlToMarkdown("   \n ")).toBe("");
  });

  it("converts the allowlisted structure", () => {
    const md = htmlToMarkdown(
      "<h2>About the role</h2><p>You will <strong>build</strong> and <em>ship</em> with <code>SQL</code>.</p>" +
        "<ul><li>One</li><li>Two</li></ul><ol><li>First</li><li>Second</li></ol>",
    );
    expect(md).toContain("## About the role");
    expect(md).toContain("You will **build** and *ship* with `SQL`.");
    expect(md).toContain("- One\n- Two");
    expect(md).toContain("1. First\n2. Second");
  });

  it("keeps http, https and mailto links and drops every other scheme", () => {
    const md = htmlToMarkdown(
      '<a href="https://a.test/x?y=1">ok</a> <a href="mailto:j@a.test">mail</a> <a href="javascript:alert(1)">bad</a> ' +
        '<a href="data:text/html,x">data</a> <a href="//evil.test">proto</a> <a href="/rel">rel</a>',
    );
    expect(md).toContain("[ok](https://a.test/x?y=1)");
    expect(md).toContain("[mail](mailto:j@a.test)");
    expect(md).not.toMatch(/javascript|data:|evil\.test|\/rel/);
    expect(md).toContain("bad");
  });

  it("never emits raw HTML: scripts, styles, handlers, iframes and comments are removed", () => {
    const md = htmlToMarkdown(
      '<p onclick="x()">Hi</p><script>alert(1)</script><style>p{}</style><iframe src="https://e.test"></iframe>' +
        '<img src=x onerror=alert(1)><!-- note --><svg><circle/></svg><p>Bye</p>',
    );
    expect(md).toBe("Hi\n\nBye");
    expect(md).not.toMatch(/<[a-z!/]/i);
  });

  it("escapes angle brackets that arrive as text so they cannot start a tag", () => {
    const md = htmlToMarkdown("<p>&lt;script&gt;alert(1)&lt;/script&gt; and a &lt; b</p>");
    expect(md).not.toMatch(/(^|[^\\])<[a-z!/]/i);
    expect(md).toContain("\\<script>");
  });

  it("handles plain markdown input unchanged apart from whitespace", () => {
    expect(htmlToMarkdown("## Title\n\n- a\n- b\n")).toBe("## Title\n\n- a\n- b");
  });

  it("escapes parentheses in link targets", () => {
    expect(htmlToMarkdown('<a href="https://a.test/a_(b)">x</a>')).toBe("[x](https://a.test/a_%28b%29)");
  });

  it("collapses blank runs and caps the length", () => {
    expect(htmlToMarkdown("<p>a</p><p></p><p></p><p>b</p>")).toBe("a\n\nb");
    const long = htmlToMarkdown(`<p>${"word ".repeat(5000)}</p>`, { maxChars: 1000 });
    expect(long.length).toBeLessThanOrEqual(1001);
    expect(long.endsWith("…")).toBe(true);
  });

  it("survives malformed and deeply nested markup", () => {
    expect(() => htmlToMarkdown("<p><b><i>unclosed")).not.toThrow();
    expect(htmlToMarkdown("<div>".repeat(500) + "deep" + "</div>".repeat(500))).toBe("deep");
    expect(htmlToMarkdown("<p>emoji 🚀 – ü</p>")).toBe("emoji 🚀 – ü");
  });

  it("keeps preformatted blocks as fences", () => {
    expect(htmlToMarkdown("<pre>a  b\n c</pre>")).toBe("```\na  b\n c\n```");
  });

  it("does not let employer text turn into a markdown link with an unsafe target", () => {
    const html = htmlToMarkdown("<p>[click](javascript:alert(1)) and ![x](data:text/html,y)</p>");
    // The brackets arrive escaped, so no markdown renderer can turn this into a link or an image.
    expect(html).not.toMatch(/(^|[^\\])[\][]/);
    expect(html).toContain("click");
  });

  it("filters link and image targets in input that is already markdown", () => {
    const md = htmlToMarkdown(
      "See [ok](https://a.test/x), [mail](mailto:a@b.test), [bad](javascript:alert(1)), [rel](/x), ![pic](https://a.test/p.png) and ![evil](data:x)\n\n[ref]: javascript:alert(1)\n",
    );
    expect(md).toContain("[ok](https://a.test/x)");
    expect(md).toContain("[mail](mailto:a@b.test)");
    expect(md).not.toMatch(/javascript|data:|\]\(\/x\)|!\[/i);
    expect(md).toContain("bad");
    expect(md).toContain("pic");
  });

  it("keeps ordinary brackets readable", () => {
    expect(htmlToMarkdown("<p>Salary [negotiable] and a[0]</p>")).toBe("Salary \\[negotiable\\] and a\\[0\\]");
    expect(htmlToMarkdown("Keep [negotiable] as is")).toBe("Keep [negotiable] as is");
  });
});
