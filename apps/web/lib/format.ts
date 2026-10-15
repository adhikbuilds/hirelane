/** Compact age: "30m", "2h", "3d". Future dates clamp to "0m". */
export function formatAge(from: Date, now: Date = new Date()): string {
  const mins = Math.max(0, Math.floor((now.getTime() - from.getTime()) / 60_000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function formatCount(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}
