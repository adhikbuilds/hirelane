const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function focusableIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.hasAttribute("inert") && el.offsetParent !== null);
}

/** Keeps Tab and Shift+Tab inside `root`. Returns true when it handled the event. */
export function trapTab(e: Pick<KeyboardEvent, "key" | "shiftKey" | "preventDefault">, root: HTMLElement): boolean {
  if (e.key !== "Tab") return false;
  const items = focusableIn(root);
  if (items.length === 0) {
    e.preventDefault();
    return true;
  }
  const first = items[0]!;
  const last = items[items.length - 1]!;
  const active = document.activeElement;
  if (e.shiftKey && (active === first || !root.contains(active))) {
    e.preventDefault();
    last.focus();
    return true;
  }
  if (!e.shiftKey && (active === last || !root.contains(active))) {
    e.preventDefault();
    first.focus();
    return true;
  }
  return false;
}
