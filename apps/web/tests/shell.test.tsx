// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MobileMenu } from "../components/shell/MobileMenu";
import { SiteFooter } from "../components/shell/SiteFooter";
import { isActive, NAV } from "../components/shell/nav";
import { readSaved, SAVED_KEY, toggleSaved } from "../components/job/useSaved";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

describe("nav", () => {
  it("lists Jobs, How it works, Pricing, Companies", () => {
    expect(NAV.map((n) => n.label)).toEqual(["Jobs", "How it works", "Pricing", "Companies"]);
  });
  it("marks sections active but never hash links", () => {
    expect(isActive("/jobs", "/jobs")).toBe(true);
    expect(isActive("/jobs/x", "/jobs")).toBe(true);
    expect(isActive("/", "/#pricing")).toBe(false);
    expect(isActive("/jobsx", "/jobs")).toBe(false);
  });
});

describe("footer", () => {
  it("has the four columns with the data links", () => {
    render(<SiteFooter />);
    for (const t of ["Product", "Data", "Company", "Legal"]) expect(screen.getByRole("heading", { name: t })).toBeInTheDocument();
    for (const l of ["API", "llms.txt", "Sitemap", "Status"]) expect(screen.getByRole("link", { name: l })).toBeInTheDocument();
  });
});

describe("MobileMenu", () => {
  it("opens, traps Tab inside, closes on Escape and returns focus", async () => {
    const user = userEvent.setup();
    render(<MobileMenu pathname="/" />);
    const trigger = screen.getByRole("button", { name: "Open menu" });
    await user.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Menu" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    for (let i = 0; i < 12; i++) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    await user.tab({ shift: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger).toHaveFocus();
  });
});

describe("saved jobs storage", () => {
  beforeEach(() => localStorage.clear());
  it("toggles a slug on and off", () => {
    expect(toggleSaved("a")).toBe(true);
    expect(readSaved()).toEqual(["a"]);
    expect(toggleSaved("a")).toBe(false);
    expect(readSaved()).toEqual([]);
  });
  it("survives corrupt storage", () => {
    localStorage.setItem(SAVED_KEY, "{not json");
    expect(readSaved()).toEqual([]);
    localStorage.setItem(SAVED_KEY, '{"a":1}');
    expect(readSaved()).toEqual([]);
  });
});
