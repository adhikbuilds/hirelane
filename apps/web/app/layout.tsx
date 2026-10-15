import type { Metadata } from "next";
import localFont from "next/font/local";
import Link from "next/link";
import type { ReactNode } from "react";
import { Wordmark } from "./wordmark";
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

const nav = [
  { href: "/jobs", label: "Jobs" },
  { href: "/companies", label: "Companies" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/pricing", label: "Pricing" },
  { href: "/login", label: "Sign in" },
];

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={overpass.variable}>
      <body>
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <header className="border-b border-rule bg-sheet">
          <div className="mx-auto flex h-14 w-full max-w-page items-center justify-between px-4 sm:px-8">
            <Link href="/" aria-label="hirelane home">
              <Wordmark />
            </Link>
            <nav aria-label="Primary">
              <ul className="flex items-center gap-4 sm:gap-6 text-[15px] font-medium">
                {nav.map((n) => (
                  <li key={n.href} className={n.href === "/companies" ? "hidden sm:list-item" : undefined}>
                    <Link href={n.href} className="text-ink-2 hover:text-lane">
                      {n.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
        </header>
        <main id="main" className="flex-1">
          {children}
        </main>
        <footer className="border-t border-rule">
          <p className="mx-auto w-full max-w-page px-4 sm:px-8 py-4 text-[13px] text-ink-3">
            hirelane. Jobs come from public company boards. You approve every application.
          </p>
        </footer>
      </body>
    </html>
  );
}
