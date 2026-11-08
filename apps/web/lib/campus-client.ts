/** Browser calls from the console to the v1 API. Same origin, so the session cookie and Origin header go with it; every mutation carries a fresh Idempotency-Key unless it is a file download. */
export interface Call<T> {
  ok: boolean;
  status: number;
  data: T | null;
  /** The problem's machine code or title, never a stack. */
  error: string | null;
}

interface Opts {
  method?: "GET" | "POST";
  json?: unknown;
  raw?: { body: BodyInit; type: string };
  /** Downloads (the NAAC file, a letter) are not stored by the server, so they carry no Idempotency-Key. */
  idempotent?: boolean;
}

async function send(url: string, o: Opts): Promise<Response | null> {
  const method = o.method ?? "GET";
  const headers: Record<string, string> = {};
  if (method !== "GET" && o.idempotent !== false) headers["idempotency-key"] = crypto.randomUUID();
  let body: BodyInit | undefined;
  if (o.json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(o.json);
  } else if (o.raw) {
    headers["content-type"] = o.raw.type;
    body = o.raw.body;
  }
  try {
    return await fetch(url, { method, credentials: "same-origin", headers, ...(body !== undefined ? { body } : {}) });
  } catch {
    return null;
  }
}

async function problem(res: Response): Promise<string> {
  const j = (await res.json().catch(() => null)) as { code?: string; title?: string } | null;
  return j?.code ?? j?.title ?? "error";
}

export async function callJson<T>(url: string, o: Opts = {}): Promise<Call<T>> {
  const res = await send(url, o);
  if (!res) return { ok: false, status: 0, data: null, error: "network" };
  if (!res.ok) return { ok: false, status: res.status, data: null, error: await problem(res) };
  return { ok: true, status: res.status, data: (await res.json().catch(() => null)) as T, error: null };
}

export async function callBlob(url: string, o: Opts = {}): Promise<Call<Blob>> {
  const res = await send(url, o);
  if (!res) return { ok: false, status: 0, data: null, error: "network" };
  if (!res.ok) return { ok: false, status: res.status, data: null, error: await problem(res) };
  return { ok: true, status: res.status, data: await res.blob(), error: null };
}

/** Hands a blob to the browser as a download. */
export function saveBlob(blob: Blob, filename: string): void {
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

const MESSAGES: Record<string, string> = {
  not_found: "That is not available to you.",
  rate_limited: "Too many tries. Wait a minute and try again.",
  bad_file_type: "That file type is not accepted. Use a CSV.",
  network: "Could not reach the server. Check the connection and try again.",
};
export const messageFor = (code: string | null): string => (code && MESSAGES[code]) || "That did not work. Try again in a moment.";
