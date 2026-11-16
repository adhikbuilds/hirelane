import Link from "next/link";
import type { ReactNode } from "react";

export type TabId = "home" | "discover" | "drives" | "tracker" | "you";

const TABS: { id: TabId; label: string; href: string; icon: ReactNode }[] = [
  {
    id: "home",
    label: "Home",
    href: "/home",
    icon: <path d="M4 11l8-7 8 7v9a1 1 0 01-1 1h-4v-6H9v6H5a1 1 0 01-1-1z" />,
  },
  {
    id: "discover",
    label: "Discover",
    href: "/jobs",
    icon: (
      <>
        <circle cx="11" cy="11" r="6" />
        <path d="M20 20l-4.5-4.5" />
      </>
    ),
  },
  {
    id: "drives",
    label: "Drives",
    href: "/drives",
    icon: (
      <>
        <rect x="4" y="5" width="16" height="15" rx="2" />
        <path d="M8 3v4M16 3v4M4 10h16" />
      </>
    ),
  },
  {
    id: "tracker",
    label: "Tracker",
    href: "/tracker",
    icon: <path d="M5 4h14v16l-7-4-7 4z" />,
  },
  {
    id: "you",
    label: "You",
    href: "/you",
    icon: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
      </>
    ),
  },
];

/** Bottom tab bar on phones, left sidebar on desktop (same links, CSS only). No client JS. */
export function TabBar({ active }: { active: TabId }) {
  return (
    <nav className="wr-tabbar" aria-label="App">
      <Link href="/home" className="wr-tabbar-brand">
        {"hire"}
        <span>lane</span>
      </Link>
      <ul>
        {TABS.map((t) => (
          <li key={t.id}>
            <Link href={t.href} aria-current={t.id === active ? "page" : undefined} data-active={t.id === active || undefined}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {t.icon}
              </svg>
              <span>{t.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
