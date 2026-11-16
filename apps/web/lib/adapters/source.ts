/**
 * Where a page's data comes from. Pure, so the whole matrix is tested.
 *
 *  - accounts flag off: development shows the labelled sample, production answers 404 (as before).
 *  - signed out: development shows the sample, production sends the person to /signin.
 *  - signed in with data: real.
 *  - signed in without data: development shows the sample; production shows the real, empty screen (or 404 where
 *    "no data" means "not allowed here", such as a student opening the console).
 *  - a failed read: development shows the sample; production never does (the error surfaces).
 *  - `prodReady: false` keeps a screen dev-only until its component stops hard-coding figures.
 */
export type Source = "real" | "sample" | "signin" | "notfound";

export interface SourceInput {
  accountsOn: boolean;
  signedIn: boolean;
  hasData: boolean;
  dev: boolean;
  /** What a signed-in person with nothing to show gets in production. Default: the real, empty screen. */
  emptyInProd?: "real" | "notfound";
  /** False while the component still hard-codes figures: production keeps answering 404. Default true. */
  prodReady?: boolean;
}

export function decideSource(i: SourceInput): Source {
  if (!i.dev && i.prodReady === false) return "notfound";
  if (!i.accountsOn) return i.dev ? "sample" : "notfound";
  if (!i.signedIn) return i.dev ? "sample" : "signin";
  if (i.hasData) return "real";
  if (i.dev) return "sample";
  return i.emptyInProd === "notfound" ? "notfound" : "real";
}
