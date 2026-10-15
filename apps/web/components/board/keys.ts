/** Pure helpers for the ledger's keyboard model: j/k move, Enter opens (native link), / searches. */
export function nextIndex(current: number, key: "j" | "k", count: number): number {
  if (count <= 0) return -1;
  if (current < 0) return key === "j" ? 0 : count - 1;
  return key === "j" ? Math.min(count - 1, current + 1) : Math.max(0, current - 1);
}

export function isTypingTarget(el: { tagName?: string; isContentEditable?: boolean } | null): boolean {
  if (!el) return false;
  const tag = (el.tagName ?? "").toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable === true;
}
