import { expect, test } from "@playwright/test";

test.describe("landing (ui-v2)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("demo-card")).toBeVisible();
  });

  test("hero shows the live subline, counts with as-of, and the demo label", async ({ page }) => {
    await expect(page.getByTestId("hero-subline")).toContainText(/company career sites every six hours/);
    await expect(page.getByTestId("live-counts")).toContainText("open roles");
    await expect(page.getByTestId("as-of")).toContainText(/as of/);
    await expect(page.getByTestId("demo-label")).toHaveText("Demo: nothing is sent");
  });

  test("approving shows the undo bar and pressing U cancels it", async ({ page }) => {
    const slug = await page.getByTestId("demo").getAttribute("data-current-slug");
    await page.getByRole("button", { name: "30 days" }).click();
    await page.getByRole("button", { name: /Approve & send/ }).click();
    await expect(page.getByTestId("undo-bar")).toBeVisible();
    await expect(page.getByTestId("demo-actions").getByText(/^Sending to /)).toBeVisible();
    await page.keyboard.press("u");
    await expect(page.getByTestId("undo-bar")).toHaveCount(0);
    await expect(page.getByTestId("demo")).toHaveAttribute("data-current-slug", slug!);
  });

  test("approval waits for the Needs-you answer", async ({ page }) => {
    await page.getByRole("button", { name: /Approve & send/ }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Answer this first" })).toBeVisible();
    await expect(page.getByTestId("undo-bar")).toHaveCount(0);
  });

  test("an approved card is handed off, then the next card arrives", async ({ page }) => {
    const first = await page.getByTestId("demo").getAttribute("data-current-slug");
    await page.getByRole("button", { name: "60 days" }).click();
    await page.getByRole("button", { name: /Approve & send/ }).click();
    await expect(page.getByTestId("demo-handed")).toContainText(/Handed off to .+'s site/, { timeout: 8000 });
    await expect(page.getByTestId("demo")).not.toHaveAttribute("data-current-slug", first!, { timeout: 8000 });
  });

  test("pass advances to the next card, and keyboard P does too", async ({ page }) => {
    const card = page.getByTestId("demo");
    const first = await card.getAttribute("data-current-slug");
    await page.getByRole("button", { name: /^Pass/ }).click();
    await expect(card).not.toHaveAttribute("data-current-slug", first!);
    const second = await card.getAttribute("data-current-slug");
    await page.locator("body").click({ position: { x: 2, y: 2 } });
    await page.keyboard.press("p");
    await expect(card).not.toHaveAttribute("data-current-slug", second!);
  });

  test("typing in the notice field never triggers the shortcuts", async ({ page }) => {
    const first = await page.getByTestId("demo").getAttribute("data-current-slug");
    await page.getByLabel(/Notice period/).fill("");
    await page.getByLabel(/Notice period/).pressSequentially("pau");
    await expect(page.getByTestId("demo")).toHaveAttribute("data-current-slug", first!);
    await expect(page.getByTestId("undo-bar")).toHaveCount(0);
  });

  test("the drop zone plays the fixture parse and states the next-release message", async ({ page }) => {
    const pdf = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF");
    await page.locator('input[type="file"]').first().setInputFiles({ name: "cv.pdf", mimeType: "application/pdf", buffer: pdf });
    await expect(page.getByTestId("resume-parse")).toBeVisible();
    await expect(page.getByTestId("parse-skills").getByText("Kafka")).toBeVisible({ timeout: 8000 });
    await expect(page.getByText(/Create your account to save this\. Coming in the next release/)).toBeVisible({ timeout: 8000 });
    await expect(page.getByRole("button", { name: "Create your account" })).toBeDisabled();
  });

  test("ticker items link to job pages", async ({ page }) => {
    const items = page.getByTestId("ticker-item");
    expect(await items.count()).toBeGreaterThanOrEqual(20);
    const href = await items.first().getAttribute("href");
    expect(href).toMatch(/^\/job\/[a-z0-9-]+$/);
    // The marquee moves under the pointer, so drive the link by keyboard.
    await items.first().focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/job\//);
  });

  test("clicking a salary step highlights its source span", async ({ page }) => {
    const card = page.getByTestId("trace-card");
    await card.scrollIntoViewIfNeeded();
    await expect(page.getByTestId("trace-highlight")).toBeVisible();
    const first = await page.getByTestId("trace-highlight").innerText();
    expect(first).toMatch(/\d/);
    const noText = page.locator('[data-testid="trace-step"][data-has-span="false"]').first();
    await noText.click();
    await expect(page.getByTestId("trace-nospan")).toBeVisible();
    await expect(page.getByTestId("trace-highlight")).toHaveCount(0);
    await page.locator('[data-testid="trace-step"][data-has-span="true"]').nth(1).click();
    await expect(page.getByTestId("trace-highlight")).toBeVisible();
  });

  test("the autopilot slider changes the number and the readout stays honest", async ({ page }) => {
    const count = page.getByTestId("autopilot-count");
    await count.scrollIntoViewIfNeeded();
    const thumb = page.getByRole("slider", { name: "Minimum match score" });
    await thumb.focus();
    await page.keyboard.press("Home");
    await expect.poll(async () => (await count.innerText()).replace(/\D/g, ""), { timeout: 8000 }).not.toBe("");
    const low = await expect.poll(async () => Number((await count.innerText()).replace(/\D/g, "")), { timeout: 8000 }).toBeGreaterThan(0);
    void low;
    const atMin = Number((await count.innerText()).replace(/\D/g, ""));
    await page.keyboard.press("End");
    await expect.poll(async () => Number((await count.innerText()).replace(/\D/g, "")), { timeout: 8000 }).not.toBe(atMin);
    await expect(page.getByTestId("autopilot-drafts")).toContainText("draft and queue");
    await expect(page.getByText("Paid plans • coming soon")).toBeVisible();
  });

  test("the pricing toggle changes prices and per-application cost", async ({ page }) => {
    const price = page.getByTestId("price-basic");
    await price.scrollIntoViewIfNeeded();
    await page.getByRole("radio", { name: "Weekly" }).click();
    await expect(price).toHaveText("$3");
    await expect(page.getByTestId("per-app-basic")).toContainText("per application");
    await page.getByRole("radio", { name: "Monthly" }).click();
    await expect(price).toHaveText("$9");
    await page.getByRole("radio", { name: "Quarterly" }).click();
    await expect(price).toHaveText("$24");
    await page.getByRole("radio", { name: "₹ INR" }).click();
    await expect(price).toHaveText("₹799");
    await expect(page.getByRole("link", { name: "Start free" }).first()).toBeVisible();
  });

  test("how it works steps change the mockup panel", async ({ page, isMobile }) => {
    test.skip(!!isMobile, "stacked cards on mobile");
    await page.getByTestId("how-it-works").scrollIntoViewIfNeeded();
    await page.getByTestId("step-approve").click();
    await expect(page.getByTestId("how-panel").locator("[data-step]")).toHaveAttribute("data-step", "approve", { timeout: 6000 });
  });

  test("@overflow has no horizontal overflow at 390px", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    expect(sw).toBeLessThanOrEqual(cw);
  });
});

test.describe("landing currency", () => {
  test.use({ locale: "en-IN", extraHTTPHeaders: { "Accept-Language": "en-IN,en;q=0.9" } });
  test("en-IN visitors see rupees first", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("price-basic")).toHaveText("₹299");
  });
});
