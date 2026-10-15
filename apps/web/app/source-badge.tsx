import { sourceBadge } from "@/lib/ledger";

/** Sign-shaped source code: gh, lv, ab. Small, ruled, not monospace. */
export function SourceBadge({ ats }: { ats: string }) {
  const code = sourceBadge(ats);
  return (
    <span
      title={ats}
      className="inline-block min-w-7 rounded-[3px] border border-lane bg-lane px-1.5 text-center text-[12px] font-semibold leading-5 text-white"
    >
      {code}
    </span>
  );
}
