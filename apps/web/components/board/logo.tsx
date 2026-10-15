import { monogram } from "../../lib/job-view";

/** 16px company mark: the logo when one is stored, otherwise a ruled monogram square. */
export function Logo16({ name, src }: { name: string; src: string | null }) {
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" width={16} height={16} className="h-4 w-4 shrink-0 border border-rule bg-sheet object-contain" />;
  }
  return (
    <span
      aria-hidden="true"
      className="inline-flex h-4 w-4 shrink-0 items-center justify-center border border-ink bg-sheet text-[8px] font-extrabold leading-none"
    >
      {monogram(name).slice(0, 1)}
    </span>
  );
}
