/** Browser calls to the v1 API. Same origin, so the session cookie and Origin header go with it; every mutation carries a fresh Idempotency-Key. */
export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  /** The problem's machine code or title, never a stack. */
  error: string | null;
}

async function call<T>(method: "POST" | "PUT", url: string, body: unknown): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      method,
      credentials: "same-origin",
      headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await res.json().catch(() => null)) as (T & { code?: string; title?: string; detail?: string }) | null;
    if (res.ok) return { ok: true, status: res.status, data: json as T, error: null };
    return { ok: false, status: res.status, data: null, error: json?.code ?? json?.title ?? "error" };
  } catch {
    return { ok: false, status: 0, data: null, error: "network" };
  }
}

export const postJson = <T>(url: string, body?: unknown): Promise<ApiResult<T>> => call<T>("POST", url, body);
export const putJson = <T>(url: string, body?: unknown): Promise<ApiResult<T>> => call<T>("PUT", url, body);

/** Skipped and saved roles are remembered on this device for the day: no service stores them yet, so the copy says so. */
const dayKey = (): string => new Date().toISOString().slice(0, 10);
export function readSet(kind: "skipped" | "saved"): Set<string> {
  try {
    const raw = window.localStorage.getItem(`hl:${kind}:${kind === "skipped" ? dayKey() : "all"}`);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}
export function writeSet(kind: "skipped" | "saved", s: Set<string>): void {
  try {
    window.localStorage.setItem(`hl:${kind}:${kind === "skipped" ? dayKey() : "all"}`, JSON.stringify([...s]));
  } catch {
    // private mode: the choice lasts until the page reloads, which is all the copy promises
  }
}
