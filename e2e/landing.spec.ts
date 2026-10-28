import { expect, test, type Page } from "@playwright/test";

/**
 * Landing v3: the hero, the swipe stack and the scroll tour (docs/design/landing-v3.md).
 * Mouse drag on desktop, touch swipe (CDP touch events, so the browser produces real touch pointer events) on the
 * mobile project. The other sections have their own specs.
 */

const top = (page: Page) => page.getByTestId("top-card");
const slug = (page: Page) => page.getByTestId("demo").getAttribute("data-current-slug");

/** Moves the pointer from the card's upper area by `dx` px and optionally releases, by mouse or by touch. */
async function drag(page: Page, dx: number, opts: { touch: boolean; release?: boolean; steps?: number; ms?: number }) {
  const box = (await top(page).boundingBox())!;
  const x0 = box.x + box.width / 2;
  const y0 = box.y + 90;
  const steps = opts.steps ?? 10;
  const ms = opts.ms ?? 24;
  const cdp = opts.touch ? await page.context().newCDPSession(page) : null;
  const pt = (x: number) => [{ x, y: y0, id: 1 }];
  if (cdp) await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pt(x0) });
  else {
    await page.mouse.move(x0, y0);
    await page.mouse.down();
  }
  for (let i = 1; i <= steps; i++) {
    const x = x0 + (dx * i) / steps;
    if (cdp) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pt(x) });
    else await page.mouse.move(x, y0);
    await page.waitForTimeout(ms);
  }
  if (opts.release !== false) {
    if (cdp) await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    else await page.mouse.up();
  }
  return { box };
}

/** Passes cards by key until the top card has (or has not) a Needs-you field. */
async function skipTo(page: Page, needs: boolean) {
  for (let i = 0; i < 8; i++) {
    if ((await top(page).getAttribute("data-needs")) === String(needs)) return;
    await page.keyboard.press("p");
    await page.waitForTimeout(450);
  }
  throw new Error(`no card with needs=${needs}`);
}

test.describe("landing v3", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => localStorage.setItem("hirelane:swipe-hint", "1"));
    await page.reload();
    await expect(top(page)).toBeVisible();
    await page.getByTestId("demo").scrollIntoViewIfNeeded();
  });

  test("hero: the two-line headline, the one line, the early-access and jobs CTAs and live counts", async ({ page }) => {
    await expect(page.getByTestId("hero-h1")).toHaveText(/Swipe right\.\s*We fill it in\./);
    await expect(page.getByTestId("hero-subline")).toHaveText("Try the swipe on real roles below. Early access opens soon.");
    await expect(page.getByTestId("hero-start")).toHaveAttribute("href", "#start");
    await expect(page.getByTestId("live-counts")).toContainText(/[\d,]+ live roles/);
    await expect(page.getByTestId("live-counts")).toContainText(/updated .+ ago/);
  });

  test("the road sign shows the top card's company and follows the next card", async ({ page }) => {
    const company = async () => (await top(page).locator("p").first().innerText()).trim();
    const first = await company();
    await expect(page.getByTestId("road-backdrop")).toContainText(first);
    await page.keyboard.press("p");
    await expect.poll(company).not.toBe(first);
    await expect(page.getByTestId("road-backdrop")).toContainText(await company());
  });

  test("three cards deep: two more cards are queued behind the top one", async ({ page }) => {
    await expect(page.getByTestId("behind-card")).toHaveCount(2);
  });

  test("swipe right past the threshold approves and opens the 4 second undo bar", async ({ page, isMobile }) => {
    await skipTo(page, false);
    const before = await slug(page);
    await drag(page, 190, { touch: !!isMobile });
    await expect(page.getByTestId("undo-bar")).toContainText(/Sending to .+ in [0-4]\.\ds/);
    await expect.poll(() => slug(page)).not.toBe(before);
    await page.keyboard.press("u");
    await expect.poll(() => slug(page)).toBe(before);
  });

  test("every card that rises to the top arrives at full size", async ({ page }) => {
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press("p");
      await page.waitForTimeout(1100);
      const t = await top(page).evaluate((el) => getComputedStyle(el).transform);
      expect(["none", "matrix(1, 0, 0, 1, 0, 0)"]).toContain(t);
    }
  });

  test("first visit: the stack nudges once and the caption explains the gesture", async ({ page }) => {
    await page.evaluate(() => localStorage.removeItem("hirelane:swipe-hint"));
    await page.reload();
    await page.getByTestId("demo").scrollIntoViewIfNeeded();
    await expect(page.getByTestId("stack-caption")).toHaveText("Swipe right to approve, left to pass. Or use A and P.");
    await expect.poll(() => page.evaluate(() => localStorage.getItem("hirelane:swipe-hint"))).toBe("1");
    await page.reload();
    await expect(page.getByTestId("stack-caption")).toHaveText("Demo: nothing is sent.");
  });

  test("swipe left past the threshold passes", async ({ page, isMobile }) => {
    const before = await slug(page);
    await drag(page, -190, { touch: !!isMobile });
    await expect(page.getByTestId("undo-bar")).toContainText("Passed");
    await expect.poll(() => slug(page)).not.toBe(before);
    await expect(page.getByTestId("live-region")).toContainText(/^Passed /);
  });

  test("a short drag springs back and decides nothing", async ({ page, isMobile }) => {
    const before = await slug(page);
    const hover = (await top(page).boundingBox())!;
    await page.mouse.move(hover.x + hover.width / 2, hover.y + 90);
    await page.waitForTimeout(700);
    const box0 = (await top(page).boundingBox())!;
    await drag(page, 40, { touch: !!isMobile, steps: 6, ms: 40 });
    await page.waitForTimeout(900);
    expect(await slug(page)).toBe(before);
    await expect(page.getByTestId("undo-bar")).toHaveCount(0);
    const box1 = (await top(page).boundingBox())!;
    expect(Math.abs(box1.x - box0.x)).toBeLessThan(3);
  });

  test("Needs-you gate: a right swipe springs back, the field is focused and says why", async ({ page, isMobile }) => {
    await skipTo(page, true);
    const before = await slug(page);
    await drag(page, 200, { touch: !!isMobile });
    await page.waitForTimeout(700);
    expect(await slug(page)).toBe(before);
    await expect(page.getByTestId("undo-bar")).toHaveCount(0);
    await expect(top(page).getByRole("alert")).toHaveText("Answer this first. Hirelane never guesses.");
    await expect(top(page).getByTestId("needs-field").locator("input")).toBeFocused();
    // A quick answer opens the gate.
    await top(page).getByTestId("needs-field").getByRole("button").first().click();
    await page.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByTestId("undo-bar")).toContainText("Sending to");
  });

  test("keys: A approves, U undoes, P passes, and typing in the field is left alone", async ({ page }) => {
    await skipTo(page, false);
    const first = await slug(page);
    await page.keyboard.press("a");
    await expect(page.getByTestId("undo-bar")).toContainText("Sending to");
    await expect(page.getByTestId("live-region")).toContainText(/Approved .+ Sending in 4 seconds\. Press U to undo\./);
    await page.keyboard.press("u");
    await expect.poll(() => slug(page)).toBe(first);
    await page.keyboard.press("ArrowLeft");
    await expect.poll(() => slug(page)).not.toBe(first);
    await page.keyboard.press("u");
    await expect.poll(() => slug(page)).toBe(first);
    await skipTo(page, true);
    const here = await slug(page);
    await top(page).getByTestId("needs-field").locator("input").pressSequentially("pau");
    expect(await slug(page)).toBe(here);
  });

  test("Space on the focused stack opens the details with every requirement, the trace and a safe link", async ({ page }) => {
    await page.getByTestId("demo").focus();
    await page.keyboard.press("Space");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("pay-trace")).toBeVisible();
    await expect(dialog.getByText(/Posting lists/).first()).toBeVisible();
    const link = dialog.getByRole("link", { name: /Open the posting/ });
    if (await link.count()) {
      await expect(link).toHaveAttribute("rel", "noopener noreferrer");
      await expect(link).toHaveAttribute("target", "_blank");
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });

  test("approving makes no network request, even after the undo window runs out", async ({ page }) => {
    await skipTo(page, false);
    const calls: string[] = [];
    page.on("request", (r) => {
      if (["fetch", "xhr", "document"].includes(r.resourceType())) calls.push(`${r.method()} ${r.url()}`);
    });
    await page.keyboard.press("a");
    await expect(page.getByTestId("undo-bar")).toBeVisible();
    await page.waitForTimeout(4600);
    await expect(page.getByText(/Handed off to .+'s site/).first()).toBeVisible();
    expect(calls).toEqual([]);
  });

  test("the end of the queue shows real tallies, Start over and the resume button", async ({ page }) => {
    let approved = 0;
    let passed = 0;
    for (let i = 0; i < 8; i++) {
      if ((await page.getByTestId("end-of-queue").count()) > 0) break;
      const needs = (await top(page).getAttribute("data-needs")) === "true";
      if (!needs && i % 2 === 0) {
        await page.keyboard.press("a");
        approved++;
      } else {
        await page.keyboard.press("p");
        passed++;
      }
      await page.waitForTimeout(350);
    }
    const end = page.getByTestId("end-of-queue");
    await expect(end).toContainText(`${approved + passed} decided: ${approved} approved, ${passed} passed.`);
    await expect(end.getByRole("link", { name: "Start with your resume" })).toHaveAttribute("href", "#start");
    await end.getByRole("button", { name: /Start over/ }).click();
    await expect(top(page)).toBeVisible();
  });

  test("the scroll tour has the four headings", async ({ page, isMobile }) => {
    const headings = ["Every match shows its maths.", "Pay, read from the posting.", "It asks. It never guesses.", "4 seconds to change your mind."];
    const root = page.getByTestId(isMobile ? "tour-static" : "tour-pinned");
    for (const h of headings) await expect(root.getByRole("heading", { name: h, includeHidden: true })).toHaveCount(1);
  });

  test("the pinned tour changes stage as the page scrolls", async ({ page, isMobile }) => {
    test.skip(!!isMobile, "static frames on phones");
    const pinned = page.getByTestId("tour-pinned");
    const y0 = await pinned.evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
    const h = await pinned.evaluate((el) => (el as HTMLElement).offsetHeight);
    const vh = page.viewportSize()!.height;
    const stage = async (f: number) => {
      await page.evaluate((y) => window.scrollTo(0, y), y0 + (h - vh) * f);
      await page.waitForTimeout(500);
      return pinned.getByTestId("tour-card").getAttribute("data-stage");
    };
    expect(await stage(0.05)).toBe("0");
    expect(await stage(0.35)).toBe("1");
    await expect(pinned.getByTestId("tour-sheet")).toBeVisible();
    await expect(pinned.getByTestId("tour-sheet").locator("mark")).toHaveCount(1);
    expect(await stage(0.6)).toBe("2");
    expect(await stage(0.85)).toBe("3");
    await expect(pinned.getByTestId("tour-undo")).toBeVisible();
    expect(await stage(0.99)).toBe("3");
    await expect(pinned.getByTestId("tour-handed")).toContainText(/Handed off to .+'s site/);
  });

  test("the round Pass and Approve buttons and the arrow keys decide", async ({ page }) => {
    await skipTo(page, false);
    const a = await slug(page);
    await page.getByRole("button", { name: /Approve/ }).first().click();
    await expect(page.getByTestId("undo-bar")).toContainText("Sending to");
    await expect.poll(() => slug(page)).not.toBe(a);
    await page.keyboard.press("u");
    await expect.poll(() => slug(page)).toBe(a);
    await page.getByRole("button", { name: /^Pass/ }).first().click();
    await expect(page.getByTestId("undo-bar")).toContainText("Passed");
    await expect.poll(() => slug(page)).not.toBe(a);
    await page.keyboard.press("u");
    await expect.poll(() => slug(page)).toBe(a);
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("undo-bar")).toContainText("Sending to");
  });

  test("touch: a vertical swipe over the card scrolls the page and decides nothing", async ({ page, isMobile }) => {
    test.skip(!isMobile, "touch only");
    const before = await slug(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    const box = (await top(page).boundingBox())!;
    const x = box.x + box.width / 2;
    const y0 = Math.min(box.y + 120, 700);
    const y1 = Math.max(y0 - 360, 20);
    const y = await page.evaluate(() => window.scrollY);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.synthesizeScrollGesture", { x, y: y0, yDistance: y1 - y0, gestureSourceType: "touch", speed: 800 });
    await page.waitForTimeout(600);
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(y);
    expect(await slug(page)).toBe(before);
    await expect(page.getByTestId("undo-bar")).toHaveCount(0);
  });

  test("the pointer events on approve are the only motion: no request leaves the page on a swipe either", async ({ page, isMobile }) => {
    await skipTo(page, false);
    const calls: string[] = [];
    page.on("request", (r) => {
      if (["fetch", "xhr", "document"].includes(r.resourceType()) && r.method() !== "GET") calls.push(`${r.method()} ${r.url()}`);
    });
    await drag(page, 190, { touch: !!isMobile });
    await expect(page.getByTestId("undo-bar")).toContainText("Sending to");
    await page.waitForTimeout(4600);
    expect(calls).toEqual([]);
  });

  test("the moments slider changes the weekly figure", async ({ page }) => {
    const panel = page.getByTestId("moment-rule");
    await panel.scrollIntoViewIfNeeded();
    const number = panel.getByTestId("rule-number");
    await expect(number).toHaveText(/[\d,]+/);
    const thumb = panel.getByRole("slider");
    await thumb.focus();
    await page.keyboard.press("Home");
    await expect(number).toHaveText(/[\d,]+/);
    const low = (await number.innerText()).trim();
    await page.keyboard.press("End");
    await expect.poll(async () => (await number.innerText()).trim()).not.toBe(low);
  });

  test("pricing controls change the price", async ({ page }) => {
    const panel = page.getByTestId("pricing-panel");
    await panel.scrollIntoViewIfNeeded();
    const price = panel.getByTestId("price");
    await panel.getByRole("radio", { name: "Free" }).click();
    await expect(price).toHaveText("Free");
    await panel.getByRole("radio", { name: "Pro" }).click();
    await expect(price).not.toHaveText("Free");
    const monthly = (await price.innerText()).trim();
    await panel.getByRole("radio", { name: "Quarterly" }).click();
    await expect.poll(async () => (await price.innerText()).trim()).not.toBe(monthly);
    const inr = (await price.innerText()).trim();
    const other = /₹|Rs/.test(inr) ? "USD" : "INR";
    await panel.getByRole("radio", { name: other }).click();
    await expect.poll(async () => (await price.innerText()).trim()).not.toBe(inr);
    await expect(panel.getByText("Planned prices. Checkout opens soon.")).toBeVisible();
    await expect(panel.getByRole("link", { name: "Get early access" })).toHaveAttribute("href", "#start");
  });

  test("start rejects a non-PDF and uploads nothing, then a PDF fills the card in the browser", async ({ page }) => {
    const calls: string[] = [];
    page.on("request", (r) => {
      if (r.method() !== "GET") calls.push(`${r.method()} ${r.url()}`);
    });
    const dialog = page.getByTestId("start-dialog");
    await dialog.scrollIntoViewIfNeeded();
    const input = dialog.locator('input[type="file"]');
    await input.setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello world, not a pdf") });
    await expect(dialog.locator("#start-error")).toContainText("not a PDF");
    await expect(dialog).toHaveAttribute("data-stage", "idle");
    await input.setInputFiles({ name: "cv.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%fake\n") });
    await expect(dialog).toHaveAttribute("data-stage", "done", { timeout: 8000 });
    await expect(dialog.getByTestId("parse-skills").locator("li")).toHaveCount(6);
    await expect(dialog.getByTestId("waitlist-form")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Get early access" })).toBeEnabled();
    expect(calls).toEqual([]);
  });

  test("Get early access in the hero scrolls to #start", async ({ page }) => {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByTestId("hero-start").click();
    await expect(page).toHaveURL(/#start$/);
    await expect.poll(() => page.evaluate(() => Math.abs(document.getElementById("start")!.getBoundingClientRect().top)), { timeout: 5000 }).toBeLessThan(80);
  });

  test("@overflow has no horizontal overflow at 390px", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    expect(sw).toBeLessThanOrEqual(cw);
  });
});

test.describe("landing v3, reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("cards cross-fade: keys still decide, the tour is static frames, the photo holds still", async ({ page }) => {
    await page.goto("/");
    await expect(top(page)).toBeVisible();
    const before = await slug(page);
    await page.keyboard.press("p");
    await expect.poll(() => slug(page)).not.toBe(before);
    await expect(page.getByTestId("tour-static")).toBeVisible();
    await expect(page.getByTestId("tour-pinned")).toBeHidden();
    const active = await page.locator('[data-testid="road-backdrop"] [data-active="true"]').getAttribute("data-slot");
    await page.waitForTimeout(8500);
    expect(await page.locator('[data-testid="road-backdrop"] [data-active="true"]').getAttribute("data-slot")).toBe(active);
  });
});
