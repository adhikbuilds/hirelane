// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const path = vi.hoisted(() => ({ value: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => path.value }));

import { SiteHeader } from "../components/shell/SiteHeader";

describe("SiteHeader routing", () => {
  beforeEach(() => {
    path.value = "/";
  });
  it("renders only the v3 floating bar on /", () => {
    const { container } = render(<SiteHeader />);
    const bars = container.querySelectorAll("[data-site-header]");
    expect(bars).toHaveLength(1);
    expect(bars[0]).toHaveAttribute("data-landing", "v3");
    expect(container.textContent).not.toContain("How it works");
  });
  it("keeps the v2 header on every other route", () => {
    for (const p of ["/jobs", "/job/some-slug", "/about"]) {
      path.value = p;
      const { container, unmount } = render(<SiteHeader />);
      const bars = container.querySelectorAll("[data-site-header]");
      expect(bars).toHaveLength(1);
      expect(bars[0]).not.toHaveAttribute("data-landing");
      expect(container.textContent).toContain("How it works");
      unmount();
    }
  });
});
