import type { ReactNode } from "react";

/** Shared frame for the content pages: one display title, left-aligned, ruled sections. */
export function PageShell({ title, lede, children }: { title: string; lede?: string; children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-page px-4 sm:px-8 py-12">
      <h1 className="display max-w-[24ch] text-[40px] sm:text-[56px]">{title}</h1>
      {lede ? <p className="mt-4 max-w-[72ch] text-[17px] text-ink-2">{lede}</p> : null}
      <div className="mt-12 max-w-[880px]">{children}</div>
    </div>
  );
}

export function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="mb-12">
      <h2 id={id} className="border-b-2 border-rule-strong pb-2 text-[17px] font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Ruled rows: a bold lead-in and the plain sentence beside it. No icons, no bullets. */
export function Rows({ rows }: { rows: { lead: string; text: string }[] }) {
  return (
    <dl>
      {rows.map((r) => (
        <div key={r.lead} className="grid gap-1 border-b border-rule py-3 sm:grid-cols-[220px_1fr] sm:gap-6">
          <dt className="font-semibold">{r.lead}</dt>
          <dd className="max-w-[72ch] text-ink-2">{r.text}</dd>
        </div>
      ))}
    </dl>
  );
}
