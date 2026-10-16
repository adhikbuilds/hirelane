import { expect, test, type APIRequestContext } from "@playwright/test";
import { MOBILE } from "./support/screens";

async function realSlug(request: APIRequest): Promise<string> {
  const res = await request.get("/api/public/jobs?pageSize=5&remote=true&salary=true");
  const body = (await res.json()) as { jobs: { slug: string }[] };
  const slug = body.jobs.find((j) => !j.slug.startsWith("e2e-"))?.slug;
  if (!slug) throw new Error("no real job in the database");
  return slug;
}
type APIRequest = APIRequestContext;

test.describe("job page v2 and shell", () => {
  test("the apply card sticks in view after scrolling (desktop)", async ({ page, request, isMobile }) => {
    test.skip(!!isMobile, "side card is sticky from lg up");
    await page.goto(`/job/${await realSlug(request)}`);
    const card = page.getByTestId("apply-card");
    await expect(card).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 900));
    await page.waitForTimeout(200);
    const box = await card.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeLessThan(200);
    await expect(page.getByTestId("apply-link")).toBeInViewport();
  });

  test("Save persists to localStorage and survives a reload", async ({ page, request }) => {
    const slug = await realSlug(request);
    await page.goto(`/job/${slug}`);
    const save = page.getByTestId("save-job").first();
    await save.click();
    await expect(save).toHaveAttribute("aria-pressed", "true");
    expect(await page.evaluate(() => localStorage.getItem("hirelane:saved-jobs"))).toContain(slug);
    await page.reload();
    await expect(page.getByTestId("save-job").first()).toHaveAttribute("aria-pressed", "true");
  });

  test("JSON-LD is present exactly once and the apply link is external", async ({ page, request }) => {
    await page.goto(`/job/${await realSlug(request)}`);
    await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(1);
    const href = await page.getByTestId("apply-link").getAttribute("href");
    expect(href).toMatch(/^https?:\/\//);
    await expect(page.getByTestId("apply-link")).toHaveAttribute("rel", /noopener/);
  });

  test("markdown twin still negotiates", async ({ request }) => {
    const slug = await realSlug(request);
    const res = await request.get(`/job/${slug}`, { headers: { accept: "text/markdown" } });
    expect(res.headers()["content-type"]).toContain("text/markdown");
  });

  test("similar roles carousel renders links to other jobs", async ({ page, request }) => {
    const slug = await realSlug(request);
    await page.goto(`/job/${slug}`);
    const links = page.getByTestId("similar-roles").locator('a[href^="/job/"]');
    if ((await links.count()) > 0) {
      expect(await links.first().getAttribute("href")).not.toBe(`/job/${slug}`);
    }
  });

  test("mobile menu traps focus, closes on Escape and restores focus", async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto("/jobs");
    const trigger = page.getByRole("button", { name: "Open menu" });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Menu" });
    await expect(dialog).toBeVisible();
    for (let i = 0; i < 9; i++) {
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
    }
    await page.keyboard.press("Shift+Tab");
    expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("header is transparent over the landing hero and solid after scroll or elsewhere", async ({ page, isMobile }) => {
    test.skip(!!isMobile, "desktop nav");
    await page.goto("/");
    await expect(page.locator("[data-site-header]")).toHaveAttribute("data-solid", "false");
    await page.evaluate(() => window.scrollTo(0, 400));
    await expect(page.locator("[data-site-header]")).toHaveAttribute("data-solid", "true");
    await page.goto("/jobs");
    await expect(page.locator("[data-site-header]")).toHaveAttribute("data-solid", "true");
  });

  test("footer has Product, Data, Company, Legal", async ({ page }) => {
    await page.goto("/about");
    const footer = page.getByRole("navigation", { name: "Footer" });
    for (const h of ["Product", "Data", "Company", "Legal"]) await expect(footer.getByRole("heading", { name: h })).toBeVisible();
    await expect(footer.getByRole("link", { name: "llms.txt" })).toBeVisible();
  });

  test("@overflow job page has no horizontal overflow at 390", async ({ page, request }) => {
    await page.setViewportSize(MOBILE);
    await page.goto(`/job/${await realSlug(request)}`);
    await expect(page.getByTestId("mobile-apply-bar")).toBeVisible();
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });
});
