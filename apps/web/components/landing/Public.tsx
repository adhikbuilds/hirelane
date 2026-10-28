import Link from "next/link";

/** Shared header for the public site: wordmark, the two audience sub-tabs, sign in. */
export function PublicHeader({ active }: { active: "home" | "students" | "universities" }) {
  return (
    <header className="pb-top">
      <Link href="/" className="cpl-brand pb-brand">
        hire<b>lane</b>
      </Link>
      <nav className="pb-tabs" aria-label="Who it's for">
        <Link href="/students" aria-current={active === "students" ? "page" : undefined}>
          For students
        </Link>
        <Link href="/colleges" aria-current={active === "universities" ? "page" : undefined}>
          For universities
        </Link>
      </nav>
      <Link className="cp-btn pb-signin" href="/signin">
        Sign in
      </Link>
    </header>
  );
}

export function PublicFooter() {
  return (
    <footer className="cpl-foot">
      <span>
        hire<b>lane</b>
      </span>
      <Link href="/students">For students</Link>
      <Link href="/colleges">For universities</Link>
      <Link href="/jobs">Browse jobs</Link>
      <Link href="/privacy">Privacy</Link>
      <Link href="/terms">Terms</Link>
      <Link href="/contact">Contact</Link>
    </footer>
  );
}
