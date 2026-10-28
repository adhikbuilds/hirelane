import { describe, expect, it, vi } from "vitest";
import { getFreshestJobs } from "../lib/queries";
import { getSession } from "../lib/session";

// getSession reads the request cookie jar; outside a request there is none, so give it an empty one.
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

describe("stubs", () => {
  it("queries return an empty ledger until ingest exists", async () => {
    expect(await getFreshestJobs(12)).toEqual({ jobs: [], refreshedAt: null, boards: 0 });
  });
  it("session is anonymous without a session cookie (and costs no database call)", async () => {
    expect(await getSession()).toBeNull();
  });
});
