import type { Metadata } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";
import { SiteChrome } from "@/components/shell/SiteChrome";
import "./globals.css";

const overpass = localFont({
  src: [
    {
      path: "./fonts/overpass-latin-wght-normal.woff2",
      weight: "100 900",
      style: "normal",
    },
  ],
  variable: "--font-overpass",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "hirelane", template: "%s | hirelane" },
  description: "Open jobs read straight from public company boards, with pay shown only when stated. Swipe-and-fill applications open with early access.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={overpass.variable}>
      <body>
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <SiteChrome part="header" />
        <main id="main" className="flex-1">
          {children}
        </main>
        <SiteChrome part="footer" />
      </body>
    </html>
  );
}
