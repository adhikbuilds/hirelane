import { expect, test, type Page } from "@playwright/test";

const rows = (page: Page) => page.getByTestId("jobs-ledger").locator("li[data-slug]");
const realRows = (page: Page) => page.getByTestId("jobs-ledger").locator('li[data-slug]:not([data-slug^="e2e-"])');
const countOf = async (page: Page): Promise<number> => Number((await page.getByTestId("jobs-count").innerText()).trim().split(/\s/)[0]!.replace(/,/g, ""));

/** Clicks and hovers before hydration are lost; React tags its DOM nodes once it owns them. */
async function ready(page: Page, url = "/jobs") {
  await page.goto(url);
  await expect
    .poll(() => page.getByTestId("all-filters").evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactFiber"))))
    .toBe(true);
}

test.describe("board v2", () => {
  test("hover and focus open the preview without navigating", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "the preview panel is a desktop (xl) feature");
    await ready(page);
    const preview = page.getByTestId("job-preview");
    await expect(preview).toBeVisible();

    const row = realRows(page).nth(2);
    const slug = (await row.getAttribute("data-slug"))!;
    const title = (await row.locator("[data-row-link]").innerText()).trim();
    await row.hover();
    await expect(preview).toHaveAttribute("data-slug", slug);
    await expect(page.getByTestId("preview-title")).toHaveText(title);
    // pay trace summary or the honest "not stated", the requirements block and the employer handoff
    await expect(preview.getByRole("region", { name: "Top requirements" })).toBeVisible();
    const apply = page.getByTestId("preview-apply");
    await expect(apply).toBeVisible();
    await expect(apply).toHaveAttribute("href", /^https?:\/\//);
    await expect(apply).toHaveAttribute("target", "_blank");
    await expect(apply).toHaveAttribute("rel", /noopener/);
    expect(new URL(page.url()).pathname).toBe("/jobs");

    // keyboard focus drives it too: j moves to the next row link
    const other = realRows(page).nth(5);
    await other.locator("[data-row-link]").focus();
    await expect(preview).toHaveAttribute("data-slug", (await other.getAttribute("data-slug"))!);
    await page.keyboard.press("j");
    await expect(preview).toHaveAttribute("data-slug", (await other.locator("xpath=following-sibling::li[1]").getAttribute("data-slug"))!);
    expect(new URL(page.url()).pathname).toBe("/jobs");
  });

  test("chips update the URL and the count, and toggle off again", async ({ page }) => {
    await ready(page);
    const all = await countOf(page);
    const chips = page.getByRole("group", { name: "Quick filters" });
    const remote = chips.getByRole("link", { name: /^Remote\b/ });
    const nShown = Number((await remote.innerText()).replace(/\D/g, ""));
    await Promise.all([page.waitForURL(/remote=1/), remote.click()]);
    expect(new URL(page.url()).searchParams.get("remote")).toBe("1");
    await expect.poll(() => countOf(page)).toBe(nShown);
    expect(nShown).toBeLessThan(all);
    await expect(page.getByRole("group", { name: "Quick filters" }).getByRole("link", { name: /^Remote\b/ })).toHaveAttribute("aria-current", "true");

    await Promise.all([page.waitForURL((u) => !u.searchParams.has("remote")), page.getByRole("group", { name: "Quick filters" }).getByRole("link", { name: /^Remote\b/ }).click()]);
    await expect.poll(() => countOf(page)).toBe(all);
  });

  test("load more appends the next page", async ({ page }) => {
    await ready(page);
    await expect(rows(page)).toHaveCount(50);
    const first = await rows(page).first().getAttribute("data-slug");
    await page.getByTestId("jobs-load-more").click();
    await expect.poll(() => rows(page).count()).toBeGreaterThan(50);
    await expect(rows(page).first()).toHaveAttribute("data-slug", first!);
    const slugs = await rows(page).evaluateAll((els) => els.map((e) => e.getAttribute("data-slug")));
    expect(new Set(slugs).size).toBe(slugs.length);
    await expect(page.getByTestId("jobs-shown")).toContainText(/Showing 1 to \d+ of/);
    expect(new URL(page.url()).searchParams.has("page")).toBe(false);
  });

  test("type-ahead suggests companies and titles, and a title keeps the filters", async ({ page }) => {
    await ready(page, "/jobs?remote=1");
    await page.keyboard.press("/");
    await expect(page.locator("#board-q")).toBeFocused();
    await page.locator("#board-q").pressSequentially("engineer", { delay: 20 });
    const list = page.getByRole("listbox", { name: "Suggestions" });
    await expect(list.getByRole("option").first()).toBeVisible();
    await expect(list.locator('[data-suggest="title"]').first()).toBeVisible();
    await page.keyboard.press("ArrowDown");
    const picked = page.locator('[role="option"][aria-selected="true"]');
    await expect(picked).toHaveCount(1);
    const kind = await picked.getAttribute("data-suggest");
    await page.keyboard.press("Enter");
    if (kind === "title") {
      await expect(page).toHaveURL(/q=.+/);
      expect(new URL(page.url()).searchParams.get("remote")).toBe("1");
    } else {
      await expect(page).toHaveURL(/\/company\//);
    }
  });

  test("j/k and / still work", async ({ page }) => {
    await ready(page);
    await page.keyboard.press("j");
    await expect(rows(page).first().locator("[data-row-link]")).toBeFocused();
    await page.keyboard.press("j");
    await expect(rows(page).nth(1).locator("[data-row-link]")).toBeFocused();
    await page.keyboard.press("k");
    await expect(rows(page).first().locator("[data-row-link]")).toBeFocused();
    await page.keyboard.press("/");
    await expect(page.locator("#board-q")).toBeFocused();
  });

  test("an honest empty state names the way out", async ({ page }) => {
    await page.goto("/jobs?q=zzqxjvwk");
    const empty = page.getByTestId("jobs-empty");
    await expect(empty).toContainText("No open jobs match these filters");
    await expect(empty.getByRole("link", { name: "Clear all filters" })).toBeVisible();
    await expect(page.getByTestId("jobs-count")).toContainText(/^0 match/);
  });

  test("@overflow no horizontal overflow at the project width, with the filter panel open", async ({ page }) => {
    await ready(page);
    await page.getByTestId("all-filters").locator("summary").first().click();
    await expect(page.getByTestId("all-filters").getByText("Country")).toBeVisible();
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over).toBeLessThanOrEqual(0);
    await page.keyboard.press("Escape");
    const over2 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over2).toBeLessThanOrEqual(0);
  });
});
