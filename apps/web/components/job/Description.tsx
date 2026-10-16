import { describe } from "./blocks";

export function Description({ text }: { text: string | null }) {
  const blocks = describe(text);
  return (
    <section aria-labelledby="desc-h">
      <h2 id="desc-h" className="text-[28px] font-extrabold tracking-[-0.03em]">About the role</h2>
      {blocks.length === 0 ? (
        <p className="mt-4 text-ink-3">The employer did not publish a description.</p>
      ) : (
        <div className="mt-4 max-w-[72ch] text-[17px] leading-[28px] text-ink-2" data-testid="job-description">
          {blocks.map((b, i) =>
            b.kind === "h" ? (
              <h3 key={i} className="mb-2 mt-8 text-[19px] font-extrabold tracking-[-0.01em] text-ink">{b.text}</h3>
            ) : b.kind === "ul" ? (
              <ul key={i} className="mb-5 space-y-2">
                {b.items.map((it, j) => (
                  <li key={j} className="flex gap-3 break-words">
                    <span aria-hidden className="mt-[11px] size-1.5 shrink-0 rounded-full bg-lane" />
                    <span className="min-w-0">{it}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p key={i} className="mb-5 break-words">{b.text}</p>
            ),
          )}
        </div>
      )}
    </section>
  );
}
