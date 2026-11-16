import Link from "next/link";
import { Wordmark } from "../../app/wordmark";
import { FOOTER } from "./nav";

export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-surface">
      <div className="mx-auto w-full max-w-page px-4 py-14 sm:px-8">
        <div className="grid gap-10 lg:grid-cols-[1.3fr_2.7fr]">
          <div className="max-w-xs">
            <Link href="/" className="inline-block">
              <Wordmark />
            </Link>
            <p className="mt-4 text-[15px] leading-6 text-ink-2">
              Open jobs from public company career boards, matched to your resume. Early access is opening soon; every decision will stay with you.
            </p>
          </div>
          <nav aria-label="Footer" className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-4">
            {FOOTER.map((col) => (
              <div key={col.title}>
                <h2 className="text-[13px] font-bold uppercase tracking-[0.08em] text-ink-3">{col.title}</h2>
                <ul className="mt-4 space-y-3">
                  {col.links.map((l) => (
                    <li key={l.href + l.label}>
                      <Link href={l.href} className="text-[15px] font-medium text-ink-2 hover:text-lane hover:underline">
                        {l.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>
        <div className="mt-12 flex flex-col gap-2 border-t border-line pt-6 text-[13px] text-ink-3 sm:flex-row sm:justify-between">
          <p>&copy; {new Date().getUTCFullYear()} Hirelane. Built by adhikbuilds.</p>
          <p>Jobs come from public Greenhouse, Lever and Ashby boards. Hirelane does not apply for anyone.</p>
        </div>
      </div>
    </footer>
  );
}
