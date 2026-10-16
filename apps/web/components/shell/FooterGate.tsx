import type { ReactNode } from "react";

/**
 * The site footer renders on every route, "/" included: landing v4 is a light page and the footer's white ground
 * closes it. Kept as a seam so a route can opt out later without touching the layout.
 */
export function FooterGate({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
