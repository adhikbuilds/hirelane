export function Wordmark() {
  return (
    <span className="inline-flex items-center gap-2">
      <svg width="12" height="16" viewBox="0 0 12 16" aria-hidden="true">
        <rect x="0" y="0" width="3" height="16" fill="var(--color-lane)" />
        <rect x="7" y="0" width="3" height="16" fill="var(--color-lane)" />
      </svg>
      <span className="display text-[22px] text-ink">hirelane</span>
    </span>
  );
}
