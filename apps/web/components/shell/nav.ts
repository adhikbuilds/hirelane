export type NavItem = { href: string; label: string };

export const NAV: NavItem[] = [
  { href: "/jobs", label: "Jobs" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/#pricing", label: "Pricing" },
  { href: "/companies", label: "Companies" },
];

export const START_FREE = { href: "/#start", label: "Get early access" } as const;

export type FooterColumn = { title: string; links: NavItem[] };

export const FOOTER: FooterColumn[] = [
  {
    title: "Product",
    links: [
      { href: "/jobs", label: "Browse jobs" },
      { href: "/how-it-works", label: "How it works" },
      { href: "/#pricing", label: "Pricing" },
      { href: "/lists", label: "Curated lists" },
    ],
  },
  {
    title: "Data",
    links: [
      { href: "/api-docs", label: "API" },
      { href: "/llms.txt", label: "llms.txt" },
      { href: "/sitemap.xml", label: "Sitemap" },
      { href: "/status", label: "Status" },
    ],
  },
  {
    title: "Company",
    links: [
      { href: "/about", label: "About" },
      { href: "/companies", label: "Companies" },
      { href: "/about#data", label: "Where jobs come from" },
    ],
  },
  {
    title: "Legal",
    links: [
      { href: "/how-it-works#never", label: "What Hirelane never does" },
      { href: "/about#limits", label: "Limits, stated outright" },
      { href: "/privacy", label: "Privacy" },
      { href: "/terms", label: "Terms" },
      { href: "/contact", label: "Contact" },
      { href: "/robots.txt", label: "robots.txt" },
    ],
  },
];

/** True when `href` is the current section (hash links never match). */
export function isActive(pathname: string, href: string): boolean {
  if (href.includes("#")) return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}
