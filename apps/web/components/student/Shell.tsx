import { Public_Sans } from "next/font/google";
import Link from "next/link";
import type { ReactNode } from "react";
import "../../app/campus.css";
import "../../app/account.css";
import "../../app/student-legacy.css";

const publicSans = Public_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-public", display: "swap" });

export type StudentTab = "home" | "jobs" | "drives" | "tracker" | "me";

const TABS: { id: StudentTab; label: string; href: string; d: string }[] = [
  { id: "home", label: "Home", href: "/home", d: "M4 11l8-7 8 7v9a1 1 0 01-1 1h-4v-6H9v6H5a1 1 0 01-1-1z" },
  { id: "jobs", label: "Jobs", href: "/jobs", d: "M11 17a6 6 0 100-12 6 6 0 000 12zM20 20l-4.5-4.5" },
  { id: "drives", label: "Drives", href: "/drives", d: "M4 5h16v15H4zM8 3v4M16 3v4M4 10h16" },
  { id: "tracker", label: "Tracker", href: "/tracker", d: "M5 4h14v16l-7-4-7 4z" },
  { id: "me", label: "Me", href: "/you", d: "M12 12a4 4 0 100-8 4 4 0 000 8zM4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" },
];

/** The previous student frame, kept for the screens not yet rebuilt (resume, network, recap, role pages). New screens use AppShell.tsx.
 * Student app frame, direction A: calm chrome, colour only on role cards. Server component. */
export function StudentShell({ active, initials, children }: { active: StudentTab; initials: string; children: ReactNode }) {
  return (
    <div className={`stl ${publicSans.variable} ${publicSans.className}`}>
      <header className="stl-top">
        <Link href="/home" className="stl-brand">
          hire<b>lane</b>
        </Link>
        <Link href="/you" className="stl-me" aria-label="Your profile">
          {initials}
        </Link>
      </header>
      <main className="stl-main" id="main-app">
        {children}
      </main>
      <nav className="stl-tabs" aria-label="App">
        <ul>
          {TABS.map((t) => (
            <li key={t.id}>
              <Link href={t.href} aria-current={t.id === active ? "page" : undefined}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d={t.d} />
                </svg>
                <span>{t.label}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

export function Chevron() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}
