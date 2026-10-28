"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/** Account screens (sign-in, welcome, You) are full-screen app pages in the Wrapped style, so they hide the site chrome. */
export const ACCOUNT_PREFIXES = ["/signin", "/welcome", "/you", "/home", "/dev/account", "/dev/campus", "/campus", "/dev/landing"] as const;

export function isAccountPath(pathname: string): boolean {
  return ACCOUNT_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function ChromeGate({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  return isAccountPath(pathname) ? null : <>{children}</>;
}
