/** The /dev pages show sample data. They exist in development, and in production only when HIRELANE_SAMPLES=1 is set on purpose. */
export function devPagesOpen(env: Record<string, string | undefined> = process.env): boolean {
  return env["NODE_ENV"] === "development" || env["HIRELANE_SAMPLES"] === "1";
}
