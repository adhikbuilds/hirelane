// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("motion/react", async (orig) => ({ ...(await orig<typeof import("motion/react")>()), useReducedMotion: () => true }));

import { Reveal } from "../components/ui/Reveal";
import { CountUp } from "../components/ui/CountUp";
import { MatchRing } from "../components/ui/MatchRing";

describe("reduced motion", () => {
  it("Reveal renders in place with no hidden initial state", () => {
    const { container } = render(<Reveal><p>Still</p></Reveal>);
    expect(container.firstElementChild?.getAttribute("style") ?? "").not.toContain("opacity");
    expect(screen.getByText("Still")).toBeVisible();
  });
  it("CountUp shows the final number immediately", () => {
    const { container } = render(<CountUp value={4321} />);
    expect(container.textContent).toBe("4,321");
  });
  it("MatchRing starts at its final stroke, not empty", () => {
    render(<MatchRing score={80} size={100} strokeWidth={10} />);
    const arc = screen.getByTestId("match-ring-arc");
    const c = 2 * Math.PI * 45;
    expect(Number(arc.getAttribute("stroke-dashoffset"))).toBeCloseTo(c * 0.2, 1);
  });
});
