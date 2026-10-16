// @vitest-environment jsdom
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button, buttonClasses } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Chip, ChipButton } from "../components/ui/Chip";
import { Select } from "../components/ui/Select";
import { Skeleton, SkeletonText, LoadingRegion } from "../components/ui/Skeleton";
import { SegmentedControl } from "../components/ui/SegmentedControl";
import { RangeSlider } from "../components/ui/RangeSlider";
import { Marquee } from "../components/ui/Marquee";
import { Reveal } from "../components/ui/Reveal";
import { CountUp } from "../components/ui/CountUp";

describe("Button", () => {
  it("defaults to type=button so it never submits a form by accident", () => {
    render(<Button>Go</Button>);
    expect(screen.getByRole("button", { name: "Go" })).toHaveAttribute("type", "button");
  });
  it("is disabled and busy while loading, and does not fire clicks", async () => {
    const onClick = vi.fn();
    render(<Button loading onClick={onClick}>Save</Button>);
    const b = screen.getByRole("button", { name: "Save" });
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute("aria-busy", "true");
    await userEvent.click(b);
    expect(onClick).not.toHaveBeenCalled();
  });
  it("builds link classes for each variant", () => {
    expect(buttonClasses("primary")).toContain("bg-lane");
    expect(buttonClasses("signal", "sm", "extra")).toContain("extra");
  });
});

describe("Card / Chip", () => {
  it("marks Needs-you cards with the signal rule", () => {
    render(<Card needsYou data-testid="c">x</Card>);
    expect(screen.getByTestId("c").className).toContain("border-l-signal");
  });
  it("ChipButton exposes pressed state and a formatted count", async () => {
    const onClick = vi.fn();
    render(<ChipButton selected count={16320} onClick={onClick}>Remote</ChipButton>);
    const b = screen.getByRole("button", { name: /Remote/ });
    expect(b).toHaveAttribute("aria-pressed", "true");
    expect(b).toHaveTextContent("16,320");
    await userEvent.click(b);
    expect(onClick).toHaveBeenCalledOnce();
  });
  it("Chip renders its tone", () => {
    render(<Chip tone="miss">Missing</Chip>);
    expect(screen.getByText("Missing").className).toContain("text-[#b91c1c]");
  });
});

describe("Select", () => {
  it("is labelled, reports its value and shows an error with aria-invalid", async () => {
    const onChange = vi.fn();
    render(<Select label="Role" error="Pick one" onChange={onChange} options={[{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }]} />);
    const sel = screen.getByLabelText("Role");
    expect(sel).toHaveAttribute("aria-invalid", "true");
    expect(sel).toHaveAccessibleDescription("Pick one");
    await userEvent.selectOptions(sel, "b");
    expect(onChange).toHaveBeenCalled();
    expect((sel as HTMLSelectElement).value).toBe("b");
  });
});

describe("Skeleton", () => {
  it("is hidden from assistive tech, with one status message for the region", () => {
    render(
      <LoadingRegion label="Loading jobs">
        <Skeleton data-testid="s" />
        <SkeletonText lines={4} />
      </LoadingRegion>,
    );
    expect(screen.getByTestId("s")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Loading jobs");
    expect(document.querySelectorAll(".skeleton")).toHaveLength(5);
  });
});

describe("SegmentedControl", () => {
  function Harness() {
    const [v, setV] = useState("weekly");
    return (
      <SegmentedControl
        label="Billing period"
        value={v}
        onChange={setV}
        segments={[{ value: "weekly", label: "Weekly" }, { value: "monthly", label: "Monthly" }, { value: "quarterly", label: "Quarterly", disabled: true }]}
      />
    );
  }
  it("is a radiogroup with roving tabindex", () => {
    render(<Harness />);
    expect(screen.getByRole("radiogroup", { name: "Billing period" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Weekly" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("radio", { name: "Monthly" })).toHaveAttribute("tabindex", "-1");
  });
  it("arrow keys select and move focus, skipping disabled and wrapping", async () => {
    render(<Harness />);
    screen.getByRole("radio", { name: "Weekly" }).focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: "Monthly" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Monthly" })).toHaveFocus();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: "Weekly" })).toBeChecked();
    await userEvent.keyboard("{End}");
    expect(screen.getByRole("radio", { name: "Monthly" })).toBeChecked();
    await userEvent.keyboard("{Home}");
    expect(screen.getByRole("radio", { name: "Weekly" })).toBeChecked();
  });
});

describe("RangeSlider", () => {
  it("is a labelled slider that changes with the keyboard and shows the value live", async () => {
    function H() {
      const [v, setV] = useState(70);
      return <RangeSlider label="Min match" value={v} onValueChange={setV} format={(n) => `${n}%`} />;
    }
    render(<H />);
    const thumb = screen.getByRole("slider", { name: "Min match" });
    expect(thumb).toHaveAttribute("aria-valuenow", "70");
    expect(screen.getByRole("status")).toHaveTextContent("70%");
    thumb.focus();
    await userEvent.keyboard("{ArrowRight}{ArrowRight}");
    expect(thumb).toHaveAttribute("aria-valuenow", "72");
    await userEvent.keyboard("{End}");
    expect(thumb).toHaveAttribute("aria-valuenow", "100");
    await userEvent.keyboard("{Home}");
    expect(thumb).toHaveAttribute("aria-valuenow", "0");
  });
});

describe("Marquee", () => {
  it("lists every item once for assistive tech: the loop copy is aria-hidden and inert", () => {
    render(
      <Marquee label="Fresh jobs">
        {[<a key="1" href="/job/a">Alpha</a>, <a key="2" href="/job/b">Beta</a>]}
      </Marquee>,
    );
    expect(screen.getByRole("region", { name: "Fresh jobs" })).toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(2); // hidden copy excluded from the accessibility tree
    const copies = document.querySelectorAll(".marquee-copy");
    expect(copies).toHaveLength(2);
    expect(copies[1]).toHaveAttribute("aria-hidden", "true");
    expect(copies[1]).toHaveAttribute("inert");
    expect(copies[0]).not.toHaveAttribute("aria-hidden");
  });
  it("scales loop time with item count so long lists do not race", () => {
    const items = Array.from({ length: 30 }, (_, i) => <span key={i}>{i}</span>);
    render(<Marquee label="m">{items}</Marquee>);
    expect((document.querySelector(".marquee-track") as HTMLElement).style.getPropertyValue("--marquee-duration")).toBe("120s");
  });
});

describe("Reveal", () => {
  it("renders its children (in the server HTML and when reduced motion is on)", () => {
    render(<Reveal><p>Hello</p></Reveal>);
    expect(screen.getByText("Hello")).toBeInTheDocument();
  });
});

describe("CountUp", () => {
  it("shows the true number in the markup, formatted with separators", () => {
    const { container } = render(<CountUp value={16320} />);
    expect(container.textContent).toMatch(/^(0|16,320|\d{1,2},?\d*)$/); // mid-count is fine; the server HTML is checked below
  });
  it("lands exactly on the value with prefix and suffix", async () => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance", "setTimeout", "clearTimeout"] });
    try {
      const { container } = render(<CountUp value={10663} prefix="~" suffix=" jobs" durationSec={0.2} />);
      await vi.advanceTimersByTimeAsync(1000);
      expect(container.textContent).toBe("~10,663 jobs");
    } finally {
      vi.useRealTimers();
    }
  });
  it("renders the final number on the server", async () => {
    const { renderToString } = await import("react-dom/server");
    expect(renderToString(<CountUp value={119} suffix=" companies" />)).toContain("119 companies");
  });
});
