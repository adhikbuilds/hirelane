"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { isAccountPath } from "./ChromeGate";

/**
 * The marketing header and footer are loaded on demand. The root layout imports only this file, so the libraries behind
 * the chrome (motion, radix, the landing header) are NOT part of the layout's shared chunk and never reach /signin,
 * /welcome, /you or /resume (Amendment B section 12: no motion on student pages). They load only where they render.
 */
const Header = dynamic(() => import("./SiteHeader").then((m) => m.SiteHeader));
const Footer = dynamic(() => import("./SiteFooter").then((m) => m.SiteFooter));

export function SiteChrome({ part }: { part: "header" | "footer" }) {
  const pathname = usePathname() ?? "/";
  if (isAccountPath(pathname)) return null;
  if (part === "header") return <Header />;
  return pathname === "/" ? null : <Footer />;
}
