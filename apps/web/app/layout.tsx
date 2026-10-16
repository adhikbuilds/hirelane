import type { Metadata } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";
import { SiteFooter } from "@/components/shell/SiteFooter";
import { SiteHeader } from "@/components/shell/SiteHeader";
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
  description: "Open jobs from public company boards, matched to your resume, applied to with your approval.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={overpass.variable}>
      <body>
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <SiteHeader />
        <main id="main" className="flex-1">
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}
