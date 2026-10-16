import Link from "next/link";

const LINKS = [
  { href: "/jobs", label: "Jobs" },
  { href: "/companies", label: "Companies" },
  { href: "/api-docs", label: "API" },
  { href: "/how-it-works#never", label: "Privacy" },
] as const;

/** One quiet line. */
export function FooterLine() {
  return (
    <footer data-landing="v3" className="bg-[#0f1f10] px-4 py-8 text-muted-foreground sm:px-8">
      <p className="t-small mx-auto flex max-w-[1200px] flex-wrap items-center justify-center gap-x-3 gap-y-1 text-center">
        <Link href="/" className="inline-flex min-h-11 items-center font-bold text-foreground hover:text-primary">Hirelane</Link>
        {LINKS.map((l) => (
          <span key={l.label} className="inline-flex items-center gap-3">
            <span aria-hidden>·</span>
            <Link href={l.href} className="inline-flex min-h-11 items-center hover:text-foreground hover:underline">{l.label}</Link>
          </span>
        ))}
        <span aria-hidden>·</span>
        <span>© 2026</span>
        <span aria-hidden>·</span>
        <span>Road photos are AI-generated.</span>
      </p>
    </footer>
  );
}
