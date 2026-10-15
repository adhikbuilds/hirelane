import { PreviewUndo } from "./preview-undo";
import { PREVIEW } from "./model";

/** A single real application preview, rendered with fixture data (an invented role and person). */
export function ApplicationPreview() {
  return (
    <section aria-labelledby="how-title" className="mt-16">
      <div className="border-b-2 border-rule-strong pb-2">
        <h2 id="how-title" className="text-[17px] font-semibold">
          How it works
        </h2>
        <p className="mt-1 max-w-[72ch] text-ink-2">
          This is one application as you see it before anything is sent. The answers are drafted from your resume,
          anything Hirelane cannot support is held for you, and approving starts a four second undo window.
          Example data.
        </p>
      </div>

      <div className="mt-6 max-w-[880px] border border-rule bg-sheet" data-testid="application-preview">
        <PreviewUndo />
        <div className="border-b border-rule px-4 py-3">
          <p className="text-[17px] font-semibold">
            {PREVIEW.role}, {PREVIEW.company}
          </p>
          <p className="text-[13px] text-ink-2">Resume used: {PREVIEW.resume}</p>
        </div>
        <ul>
          {PREVIEW.fields.map((f) => (
            <li
              key={f.label}
              className={
                f.needsYou
                  ? "border-b border-rule border-l-4 border-l-signal px-4 py-3"
                  : "border-b border-rule border-l-4 border-l-transparent px-4 py-3"
              }
              data-needs-you={f.needsYou ? "true" : undefined}
            >
              <p className="text-[13px] font-medium text-ink-2">{f.label}</p>
              {f.needsYou ? (
                <>
                  <p className="mt-1 font-semibold">Needs you</p>
                  <p className="text-ink-2">{f.reason}</p>
                </>
              ) : (
                <>
                  <p className="mt-1 max-w-[72ch]">{f.value}</p>
                  <p className="mt-1 text-[13px] text-ink-3">{f.source}</p>
                </>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
