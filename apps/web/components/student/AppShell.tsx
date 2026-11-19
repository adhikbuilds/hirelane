import Link from "next/link";
import type { ReactNode } from "react";
import "../../app/student.css";
import { Ic, type IconName } from "./Icon";
import { geist, geistMono, bricolage } from "@/lib/fonts";

/** The three font variables, for every student surface (the app frame and the dark onboarding frame). */
export const studentFonts = `${geist.variable} ${geistMono.variable} ${bricolage.variable}`;

export type StudentTab = "home" | "picks" | "drives" | "tracker" | "you";

const TABS: { id: StudentTab; label: string; href: string; icon: IconName }[] = [
  { id: "home", label: "Home", href: "/home", icon: "home" },
  { id: "picks", label: "Picks", href: "/picks", icon: "cards" },
  { id: "drives", label: "Drives", href: "/drives", icon: "cal" },
  { id: "tracker", label: "Tracker", href: "/tracker", icon: "inbox" },
  { id: "you", label: "You", href: "/you", icon: "user" },
];

export function Wordmark() {
  return (
    <Link className="st-wm" href="/home">
      hire<span>lane</span>
    </Link>
  );
}

/**
 * The student app frame (DESIGN.md 4.5): a rail on a laptop, a top bar and five tabs on a phone. Server component.
 * The Tracker badge counts what is waiting on the student, so it is never decorative.
 */
export function StudentShell({ active, initial, badge = 0, children }: { active: StudentTab | null; initial: string; badge?: number; children: ReactNode }) {
  return (
    <div className={`st ${studentFonts}`} data-surface="app">
      <div className="st-app-lay">
        <aside className="st-a-rail">
          <div className="st-a-rail-in">
            <Wordmark />
            <nav className="st-a-nav" aria-label="App">
              {TABS.map((t) => (
                <Link key={t.id} href={t.href} aria-current={t.id === active ? "page" : undefined}>
                  <Ic name={t.icon} />
                  {t.label}
                  {t.id === "tracker" && badge > 0 ? <span className="st-badge st-num">{badge}</span> : null}
                </Link>
              ))}
            </nav>
            <p className="st-foot">Hirelane never charges you.</p>
          </div>
        </aside>
        <div className="st-a-body">
          <header className="st-a-top">
            <Wordmark />
            <Link className="st-av" href="/you" aria-label="Your profile">
              {initial}
            </Link>
          </header>
          <main className="st-a-main" id="main-app">
            {children}
          </main>
          <nav className="st-a-tabs" aria-label="Tabs">
            {TABS.map((t) => (
              <Link key={t.id} href={t.href} aria-current={t.id === active ? "page" : undefined}>
                <Ic name={t.icon} />
                {t.label}
                {t.id === "tracker" && badge > 0 ? <span className="st-bdg st-num">{badge}</span> : null}
              </Link>
            ))}
          </nav>
        </div>
      </div>
    </div>
  );
}

/** One ruled row that leads somewhere: title, one grey line, an optional right-hand label and a chevron. */
export function RowLink({ href, title, meta, action, children }: { href: string; title: string; meta?: ReactNode; action?: string; children?: ReactNode }) {
  return (
    <Link className="st-rowlink" href={href}>
      <span className="st-rl-main">
        <span className="st-rl-t">{title}</span>
        {children}
        {meta ? <span className="st-rl-m">{meta}</span> : null}
      </span>
      {action ? <span className="st-rl-a">{action}</span> : null}
      <Ic name="chev" small />
    </Link>
  );
}

/** The dark onboarding frame (approved as captured): Bricolage type, a cream card on a lime tilt. */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className={`st st-auth ${studentFonts}`} data-surface="auth">
      <div className="st-au-in">
        <div className="st-au-wm">
          hire<span>lane</span>
        </div>
        {children}
        <div className="st-au-foot">
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/contact">Contact</Link>
          <span>Hirelane never charges you to apply.</span>
        </div>
      </div>
    </div>
  );
}
