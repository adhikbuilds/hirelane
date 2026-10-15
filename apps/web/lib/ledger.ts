export const PAGE_SIZE = 50;

export function parsePage(v: string | string[] | undefined): number {
  const s = Array.isArray(v) ? v[0] : v;
  if (!s || !/^\d{1,6}$/.test(s)) return 1;
  const n = Number(s);
  return n >= 1 ? n : 1;
}

export const pageOffset = (page: number) => (page - 1) * PAGE_SIZE;
export const totalPages = (count: number) => Math.max(1, Math.ceil(count / PAGE_SIZE));

const BADGES: Record<string, string> = { greenhouse: "gh", lever: "lv", ashby: "ab" };
export const sourceBadge = (ats: string) => BADGES[ats] ?? "??";
