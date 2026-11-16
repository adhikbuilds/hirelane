// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import Privacy, { metadata as privacyMeta } from "../app/privacy/page";
import Terms, { metadata as termsMeta } from "../app/terms/page";
import Contact, { metadata as contactMeta } from "../app/contact/page";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

const PLACEHOLDER = /to be named before accounts open/i;

describe("legal pages", () => {
  it("are server components with no client JS", () => {
    for (const p of ["privacy", "terms", "contact"]) {
      const src = readFileSync(join(__dirname, "..", "app", p, "page.tsx"), "utf8");
      expect(src).not.toMatch(/^\s*["']use client["']/m);
      expect(src).not.toMatch(/\buse(State|Effect|Ref)\b/);
    }
  });

  it("have titles and one h1 each", () => {
    expect(privacyMeta.title).toBe("Privacy");
    expect(termsMeta.title).toBe("Terms");
    expect(contactMeta.title).toBe("Contact");
    for (const Page of [Privacy, Terms, Contact]) {
      const { unmount } = render(<Page />);
      expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
      unmount();
    }
  });

  it("privacy states today's data collection honestly", () => {
    const { container } = render(<Privacy />);
    const t = container.textContent ?? "";
    expect(t).toMatch(/email/i);
    expect(t).toMatch(/graduation year/i);
    expect(t).toMatch(/consent/i);
    expect(t).toMatch(/no resumes are uploaded/i);
    expect(t).toMatch(/rate.limit/i);
    expect(t).toMatch(/IP address/i);
    expect(t).toMatch(/encrypted at rest/i);
    expect(t).toMatch(/only with your consent/i);
    expect(t).toMatch(/24 hours/i);
    expect(t).toMatch(/export/i);
    // Future features are future: never presented as current.
    expect(t).not.toMatch(/resumes? (is|are) (stored|encrypted)/i);
  });

  it("privacy shows a visible grievance-officer placeholder", () => {
    render(<Privacy />);
    expect(screen.getByTestId("grievance-officer")).toHaveTextContent(PLACEHOLDER);
  });

  it("terms are plain about the pre-launch state", () => {
    const { container } = render(<Terms />);
    expect(container.textContent).toMatch(/early access/i);
    expect(container.textContent).toMatch(/no accounts/i);
    expect(container.textContent).toMatch(/does not submit applications/i);
  });

  it("contact names a placeholder contact and does not invent an address", () => {
    const { container } = render(<Contact />);
    expect(screen.getByTestId("privacy-contact")).toHaveTextContent(PLACEHOLDER);
    expect(container.querySelector('a[href^="mailto:"]')).toBeNull();
  });
});
