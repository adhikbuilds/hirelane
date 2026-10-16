// @vitest-environment jsdom
import { useState } from "react";
import { createEvent, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Combobox, type ComboboxOption } from "../components/ui/Combobox";
import { DropZone, validatePdf } from "../components/ui/DropZone";
import { CompanyLogo } from "../components/brand/CompanyLogo";
import { hueFor, initialsFor, safeLogo } from "../components/brand/logo-hue";

const OPTS: ComboboxOption[] = [
  { value: "razorpay", label: "Razorpay", hint: "Fintech" },
  { value: "stripe", label: "Stripe", hint: "Payments" },
  { value: "swiggy", label: "Swiggy" },
  { value: "zepto", label: "Zepto" },
];

function Harness({ onPick }: { onPick?: (v: string | null) => void }) {
  const [v, setV] = useState<string | null>(null);
  return <Combobox label="Company" options={OPTS} value={v} onChange={(x) => { setV(x); onPick?.(x); }} />;
}

describe("Combobox (ARIA 1.2)", () => {
  it("exposes the combobox pattern: role, collapsed state, listbox relationship", () => {
    render(<Harness />);
    const input = screen.getByRole("combobox", { name: "Company" });
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(input).toHaveAttribute("aria-autocomplete", "list");
    expect(input).toHaveAttribute("aria-haspopup", "listbox");
    const listId = input.getAttribute("aria-controls")!;
    expect(document.getElementById(listId)).toHaveAttribute("role", "listbox");
    expect(input).not.toHaveAttribute("aria-activedescendant");
  });

  it("opens on focus, filters as you type and tracks the active option by id", async () => {
    render(<Harness />);
    const input = screen.getByRole("combobox");
    await userEvent.click(input);
    expect(input).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("option")).toHaveLength(4);
    await userEvent.type(input, "s");
    // Razorpay (no s) is gone; Stripe, Swiggy remain; hint search also matches "Payments" for Stripe only.
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(expect.arrayContaining([expect.stringContaining("Stripe"), expect.stringContaining("Swiggy")]));
    expect(screen.queryByRole("option", { name: /Razorpay/ })).toBeNull();
    const active = input.getAttribute("aria-activedescendant")!;
    expect(document.getElementById(active)).toHaveAttribute("role", "option");
    expect(document.getElementById(active)).toHaveTextContent("Stripe");
  });

  it("moves with arrows (wrapping), jumps with Home/End, picks with Enter", async () => {
    const onPick = vi.fn();
    render(<Harness onPick={onPick} />);
    const input = screen.getByRole("combobox");
    input.focus();
    await userEvent.keyboard("{ArrowDown}");
    const idOf = () => document.getElementById(input.getAttribute("aria-activedescendant")!)!.textContent;
    expect(idOf()).toContain("Razorpay");
    await userEvent.keyboard("{ArrowDown}");
    expect(idOf()).toContain("Stripe");
    await userEvent.keyboard("{ArrowUp}{ArrowUp}");
    expect(idOf()).toContain("Zepto"); // wrapped
    await userEvent.keyboard("{Home}");
    expect(idOf()).toContain("Razorpay");
    await userEvent.keyboard("{End}");
    expect(idOf()).toContain("Zepto");
    await userEvent.keyboard("{Enter}");
    expect(onPick).toHaveBeenCalledWith("zepto");
    expect(input).toHaveValue("Zepto");
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("option", { hidden: true, name: /Zepto/ })).toHaveAttribute("aria-selected", "true");
  });

  it("Escape closes first, then clears the selection", async () => {
    const onPick = vi.fn();
    render(<Harness onPick={onPick} />);
    const input = screen.getByRole("combobox");
    await userEvent.click(input);
    await userEvent.click(screen.getByRole("option", { name: /Stripe/ }));
    expect(input).toHaveValue("Stripe");
    await userEvent.keyboard("{ArrowDown}");
    expect(input).toHaveAttribute("aria-expanded", "true");
    await userEvent.keyboard("{Escape}");
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(input).toHaveValue("Stripe");
    await userEvent.keyboard("{Escape}");
    expect(input).toHaveValue("");
    expect(onPick).toHaveBeenLastCalledWith(null);
  });

  it("shows an empty message and no active descendant when nothing matches; Enter does nothing", async () => {
    const onPick = vi.fn();
    render(<Harness onPick={onPick} />);
    const input = screen.getByRole("combobox");
    await userEvent.type(input, "zzzz");
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByText("No matches")).toBeVisible();
    await userEvent.keyboard("{Enter}");
    expect(onPick).not.toHaveBeenCalled();
  });

  it("delegates filtering to the caller when onInputChange is given", async () => {
    const onInput = vi.fn();
    render(<Combobox label="Search" options={OPTS} value={null} onChange={() => {}} onInputChange={onInput} />);
    await userEvent.type(screen.getByRole("combobox"), "qq");
    expect(onInput).toHaveBeenLastCalledWith("qq");
    expect(screen.getAllByRole("option")).toHaveLength(4); // shown as given
  });

  it("handles special characters and unicode in the query without throwing", async () => {
    render(<Harness />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "[.*+?^$ \u{1F680} \u00e9" } });
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });
});

const pdf = (name = "cv.pdf", body = "%PDF-1.7 hello") => new File([body], name, { type: "application/pdf" });

describe("DropZone", () => {
  afterEach(() => vi.restoreAllMocks());

  it("is a focusable button; Enter and Space open the file picker", async () => {
    render(<DropZone onFile={() => {}} />);
    const btn = screen.getByRole("button", { name: /Drop your resume here/ });
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    const click = vi.spyOn(input, "click");
    btn.focus();
    expect(btn).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard(" ");
    expect(click).toHaveBeenCalledTimes(2);
  });

  it("restricts the picker to PDF", () => {
    render(<DropZone onFile={() => {}} />);
    expect(document.querySelector('input[type="file"]')).toHaveAttribute("accept", "application/pdf,.pdf");
  });

  it("accepts a PDF chosen through the picker", async () => {
    const onFile = vi.fn();
    render(<DropZone onFile={onFile} />);
    await userEvent.upload(document.querySelector<HTMLInputElement>('input[type="file"]')!, pdf(), { applyAccept: false });
    await waitFor(() => expect(onFile).toHaveBeenCalledTimes(1));
    expect(onFile.mock.calls[0]![0].name).toBe("cv.pdf");
  });

  it("accepts a dropped PDF and highlights while dragging over", async () => {
    const onFile = vi.fn();
    render(<DropZone onFile={onFile} />);
    const btn = screen.getByRole("button");
    fireEvent.dragEnter(btn);
    expect(btn).toHaveAttribute("data-over", "true");
    fireEvent.drop(btn, { dataTransfer: { files: [pdf("dropped.pdf")] } });
    expect(btn).not.toHaveAttribute("data-over");
    await waitFor(() => expect(onFile).toHaveBeenCalledTimes(1));
  });

  it.each([
    ["a text file", new File(["hi"], "notes.txt", { type: "text/plain" }), "not-pdf"],
    ["a PNG", new File(["x"], "me.png", { type: "image/png" }), "not-pdf"],
    ["a .pdf-named file that is not a PDF", new File(["MZ not a pdf"], "evil.pdf", { type: "application/pdf" }), "not-pdf"],
    ["an empty file", new File([], "empty.pdf", { type: "application/pdf" }), "empty"],
  ])("rejects %s with an inline alert and no callback", async (_n, file, reason) => {
    const onFile = vi.fn();
    const onReject = vi.fn();
    render(<DropZone onFile={onFile} onReject={onReject} />);
    fireEvent.drop(screen.getByRole("button"), { dataTransfer: { files: [file] } });
    await waitFor(() => expect(onReject).toHaveBeenCalledWith(reason));
    expect(onFile).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).not.toBeEmptyDOMElement();
  });

  it("rejects more than one file and files over 10 MB", async () => {
    const onReject = vi.fn();
    render(<DropZone onFile={() => {}} onReject={onReject} />);
    fireEvent.drop(screen.getByRole("button"), { dataTransfer: { files: [pdf("a.pdf"), pdf("b.pdf")] } });
    await waitFor(() => expect(onReject).toHaveBeenCalledWith("multiple"));
    const big = pdf("big.pdf");
    Object.defineProperty(big, "size", { value: 11 * 1024 * 1024 });
    expect(await validatePdf(big)).toBe("too-large");
  });

  it("clears a previous error after a valid file", async () => {
    render(<DropZone onFile={() => {}} />);
    const btn = screen.getByRole("button");
    fireEvent.drop(btn, { dataTransfer: { files: [new File(["x"], "a.txt", { type: "text/plain" })] } });
    await waitFor(() => expect(screen.getByRole("alert")).not.toBeEmptyDOMElement());
    fireEvent.drop(btn, { dataTransfer: { files: [pdf()] } });
    await waitFor(() => expect(screen.getByRole("alert")).toBeEmptyDOMElement());
  });

  it("never touches the network: no fetch, XHR, sendBeacon or FormData", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const xhr = vi.spyOn(XMLHttpRequest.prototype, "send");
    const beacon = vi.fn();
    Object.defineProperty(navigator, "sendBeacon", { value: beacon, configurable: true });
    const onFile = vi.fn();
    render(<DropZone onFile={onFile} />);
    fireEvent.drop(screen.getByRole("button"), { dataTransfer: { files: [pdf()] } });
    await waitFor(() => expect(onFile).toHaveBeenCalled());
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xhr).not.toHaveBeenCalled();
    expect(beacon).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("prevents the browser from navigating to a dropped file", () => {
    render(<DropZone onFile={() => {}} />);
    const ev = createEvent.drop(screen.getByRole("button"), { dataTransfer: { files: [] } });
    fireEvent(screen.getByRole("button"), ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  it("shows the accepted file name and can be disabled", () => {
    const { rerender } = render(<DropZone onFile={() => {}} accepted="cv.pdf" />);
    expect(screen.getByRole("button")).toHaveTextContent("cv.pdf");
    rerender(<DropZone onFile={() => {}} disabled />);
    expect(screen.getByRole("button")).toBeDisabled();
  });
});

describe("CompanyLogo", () => {
  it("shows the stored logo when present", () => {
    render(<CompanyLogo name="Razorpay" src="/brand/razorpay.png" />);
    const img = document.querySelector("img")!;
    expect(img).toHaveAttribute("src", "/brand/razorpay.png");
    expect(img).toHaveAttribute("alt", "");
  });

  it("falls back to a monogram when there is no logo", () => {
    render(<CompanyLogo name="Razorpay" src={null} />);
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector('[data-logo="monogram"]')).toHaveTextContent("RA");
  });

  it("swaps a logo that fails to load for the monogram: never a broken image", () => {
    render(<CompanyLogo name="Acme Rockets" src="/brand/gone.png" />);
    fireEvent.error(document.querySelector("img")!);
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector('[data-logo="monogram"]')).toHaveTextContent("AR");
  });

  it("refuses unsafe sources (external, protocol-relative, traversal) and uses the monogram", () => {
    for (const bad of ["https://evil.test/x.png", "//evil.test/x.png", "/brand/../../etc/passwd", "javascript:alert(1)", "/a\\b"]) {
      const { unmount } = render(<CompanyLogo name="Zed" src={bad} />);
      expect(document.querySelector("img")).toBeNull();
      unmount();
    }
  });

  it("hashes the hue deterministically, distinguishes names and ignores case and spacing at the edges", () => {
    expect(hueFor("Razorpay")).toBe(hueFor("  razorpay "));
    expect(hueFor("Razorpay")).not.toBe(hueFor("Stripe"));
    const hues = new Set(["A", "B", "C", "Acme", "Globex", "Initech", "Umbrella", "Hooli", "Stark", "Wayne"].map(hueFor));
    expect(hues.size).toBeGreaterThanOrEqual(8);
    for (const n of ["", "x", "日本語", "\u{1F680}"]) expect(hueFor(n)).toBeGreaterThanOrEqual(0);
    expect(hueFor("Razorpay")).toBeLessThan(360);
  });

  it("derives sensible initials for odd names", () => {
    expect(initialsFor("")).toBe("?");
    expect(initialsFor("   ")).toBe("?");
    expect(initialsFor("stripe")).toBe("ST");
    expect(initialsFor("Acme Rockets Inc")).toBe("AR");
    expect(initialsFor("\u{1F680} Launch")).toBe("\u{1F680}L");
    expect(safeLogo("/brand/a.png")).toBe("/brand/a.png");
    expect(safeLogo(undefined)).toBeNull();
  });

  it("applies the requested size", () => {
    render(<CompanyLogo name="Zed" size={56} />);
    const el = document.querySelector<HTMLElement>('[data-logo="monogram"]')!;
    expect(el.style.width).toBe("56px");
    expect(el.style.height).toBe("56px");
  });
});
