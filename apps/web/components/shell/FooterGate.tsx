"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/** The v3 landing ends with its own one-line footer, so the site footer renders on every route except "/". */
export function FooterGate({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  return pathname === "/" ? null : <>{children}</>;
}
