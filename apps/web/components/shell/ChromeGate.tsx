"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/** Account screens (sign-in, welcome, You) are full-screen app pages in the Wrapped style, so they hide the site chrome. */
export const ACCOUNT_PREFIXES = ["/signin", "/welcome", "/you", "/home", "/picks", "/drives", "/tracker", "/recap", "/paste", "/network", "/resume", "/pick", "/co", "/discover", "/dev/account", "/dev/campus", "/campus", "/dev/landing", "/dev/student", "/colleges", "/students"] as const;

/** The new landing at "/" brings its own header, so the site chrome hides there too (exact match only). */
const EXACT = ["/"];

export function isAccountPath(pathname: string): boolean {
  return EXACT.includes(pathname) || ACCOUNT_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function ChromeGate({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  return isAccountPath(pathname) ? null : <>{children}</>;
}
