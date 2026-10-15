import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const screensDir = resolve(root, "docs/screens");

export const DESKTOP = { width: 1440, height: 900 } as const;
export const MOBILE = { width: 390, height: 844 } as const;

export function phaseScreenPaths(n: number) {
  return {
    desktop: resolve(screensDir, `phase-${n}.png`),
    mobile: resolve(screensDir, `phase-${n}-mobile.png`),
  };
}

/** Saves docs/screens/phase-N.png (1440 full page) and phase-N-mobile.png (390x844). */
export async function savePhaseScreen(page: Page, n: number) {
  const paths = phaseScreenPaths(n);
  mkdirSync(screensDir, { recursive: true });
  const original = page.viewportSize();

  await page.setViewportSize(DESKTOP);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: paths.desktop, fullPage: true });

  await page.setViewportSize(MOBILE);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: paths.mobile, fullPage: false });

  if (original) await page.setViewportSize(original);
  return paths;
}
