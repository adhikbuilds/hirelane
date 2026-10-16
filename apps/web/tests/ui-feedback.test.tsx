// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UndoBar } from "../components/ui/UndoBar";
import { MatchRing, clampScore, ringTone } from "../components/ui/MatchRing";

describe("UndoBar", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance", "setTimeout", "clearTimeout", "Date"] });
  });
  afterEach(() => vi.useRealTimers());

  const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

  it("counts down from 4.0s, announces the label once, and completes exactly once at 4000 ms", async () => {
    const onComplete = vi.fn();
    const onUndo = vi.fn();
    render(<UndoBar label="Sending to Razorpay" onUndo={onUndo} onComplete={onComplete} />);
    expect(screen.getByRole("status")).toHaveTextContent("Sending to Razorpay");
    expect(screen.getByTestId("undo-countdown")).toHaveTextContent("4.0s");
    expect(screen.getByTestId("undo-countdown").className).toContain("tabular-nums");
    await advance(800);
    expect(screen.getByTestId("undo-countdown")).toHaveTextContent("3.2s");
    // The bar drains linearly: ~80% left.
    expect(parseFloat((screen.getByTestId("undo-bar") as HTMLElement).style.transform.replace("scaleX(", ""))).toBeCloseTo(0.8, 1);
    await advance(3100);
    expect(onComplete).not.toHaveBeenCalled();
    await advance(200);
    expect(onComplete).toHaveBeenCalledTimes(1);
    await advance(2000);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onUndo).not.toHaveBeenCalled();
  });

  it("honours a custom duration", async () => {
    const onComplete = vi.fn();
    render(<UndoBar label="x" durationMs={1000} onUndo={() => {}} onComplete={onComplete} />);
    await advance(1100);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it.each([["u"], ["U"], ["Escape"]])("undoes on the %s key and then never completes", async (key) => {
    const onComplete = vi.fn();
    const onUndo = vi.fn();
    render(<UndoBar label="x" onUndo={onUndo} onComplete={onComplete} />);
    await advance(500);
    fireEvent.keyDown(window, { key });
    expect(onUndo).toHaveBeenCalledTimes(1);
    await advance(5000);
    expect(onComplete).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key });
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it("undoes from the button", async () => {
    const onUndo = vi.fn();
    render(<UndoBar label="x" onUndo={onUndo} onComplete={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Undo/ }));
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it("ignores U typed into a field but still honours Escape, and ignores modified keys", async () => {
    const onUndo = vi.fn();
    render(
      <>
        <input aria-label="Notice period" />
        <UndoBar label="x" onUndo={onUndo} onComplete={() => {}} />
      </>,
    );
    fireEvent.keyDown(screen.getByLabelText("Notice period"), { key: "u" });
    expect(onUndo).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "u", metaKey: true });
    expect(onUndo).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByLabelText("Notice period"), { key: "Escape" });
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it("does not complete after unmount", async () => {
    const onComplete = vi.fn();
    const { unmount } = render(<UndoBar label="x" onUndo={() => {}} onComplete={onComplete} />);
    unmount();
    await advance(5000);
    expect(onComplete).not.toHaveBeenCalled();
  });
});

describe("MatchRing", () => {
  it("describes the score for assistive tech and shows the number", () => {
    render(<MatchRing score={82} />);
    expect(screen.getByRole("img", { name: "Match score 82 out of 100, strong match" })).toHaveTextContent("82");
  });
  it("clamps and sanitises scores", () => {
    expect([clampScore(-5), clampScore(250), clampScore(NaN), clampScore(Infinity), clampScore(49.6)]).toEqual([0, 100, 0, 0, 50]);
  });
  it("colours by state at the thresholds", () => {
    expect(ringTone(75).label).toBe("strong match");
    expect(ringTone(74).label).toBe("partial match");
    expect(ringTone(50).label).toBe("partial match");
    expect(ringTone(49).label).toBe("weak match");
  });
  it("renders an empty ring for 0 and a full one for 100 without NaN attributes", () => {
    const { rerender } = render(<MatchRing score={0} size={100} strokeWidth={10} />);
    const c = 2 * Math.PI * 45;
    expect(screen.getByTestId("match-ring-arc").getAttribute("stroke-dasharray")).toBe(String(c));
    rerender(<MatchRing score={100} size={100} strokeWidth={10} />);
    expect(screen.getByRole("img")).toHaveAttribute("aria-label", expect.stringContaining("100 out of 100"));
  });
});
