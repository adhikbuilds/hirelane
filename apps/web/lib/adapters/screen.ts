import { decideSource } from "./source";

/** What a loader's read returns: the adapted data, whether the services had nothing to show, and whether this person may not be here at all. */
export interface Read<T> {
  data: T;
  empty: boolean;
  /** Signed in but not allowed on this screen (a student opening the console). 404 in production. */
  forbidden?: boolean;
}

export type Screen<T> = { source: "real"; data: T } | { source: "sample" };

/** The few things resolveScreen needs from the world, injected so the decision is tested without Next or a database. */
export interface ScreenEnv<Ctx> {
  dev: boolean;
  accountsOn(): Promise<boolean>;
  /** The signed-in person's service context, or null when signed out. */
  ctx(): Promise<Ctx | null>;
  redirect(to: string): never;
  notFound(): never;
  log(line: string): void;
}

export interface ScreenOpts<Ctx, T> {
  read(ctx: Ctx): Promise<Read<T>>;
  /** False while the component still hard-codes figures: production answers 404 and never reads. */
  prodReady?: boolean;
}

/**
 * The one decision every wired page makes (see source.ts for the matrix). Development falls back to the labelled
 * sample when the flag is off, nobody is signed in, there is no data, or the read throws. Production never does:
 * an error there surfaces instead of quietly showing sample numbers.
 */
export async function resolveScreen<Ctx, T>(env: ScreenEnv<Ctx>, opts: ScreenOpts<Ctx, T>): Promise<Screen<T>> {
  const prodReady = opts.prodReady ?? true;
  if (!env.dev && !prodReady) return env.notFound();
  const accountsOn = await env.accountsOn();

  let read: Read<T> | null = null;
  let signedIn = false;
  if (accountsOn) {
    try {
      const ctx = await env.ctx();
      if (ctx) {
        signedIn = true;
        read = await opts.read(ctx);
      }
    } catch (e) {
      if (!env.dev) throw e;
      env.log(`[screen] read failed (${e instanceof Error ? e.name : "error"}); showing the sample in development`);
      return { source: "sample" };
    }
  }

  const source = decideSource({ accountsOn, signedIn, hasData: !!read && !read.empty, dev: env.dev, emptyInProd: read?.forbidden ? "notfound" : "real", prodReady });
  if (source === "real" && read) return { source: "real", data: read.data };
  if (source === "signin") return env.redirect("/signin");
  if (source === "notfound") return env.notFound();
  // Defence in depth: a labelled sample is never shown outside development, whatever decideSource said.
  if (!env.dev) return env.notFound();
  return { source: "sample" };
}

/** Labelled samples are for local development only (or an explicit HIRELANE_SAMPLES=1). A host with NODE_ENV unset or "test" is not development. */
export function isDevEnv(env: Record<string, string | undefined> = process.env): boolean {
  return env["NODE_ENV"] === "development" || env["HIRELANE_SAMPLES"] === "1";
}
