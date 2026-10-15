import { describe, expect, it } from "vitest";
import { getFreshestJobs } from "../lib/queries";
import { getSession } from "../lib/session";

describe("stubs", () => {
  it("queries return an empty ledger until ingest exists", async () => {
    expect(await getFreshestJobs(12)).toEqual({ jobs: [], refreshedAt: null, boards: 0 });
  });
  it("session is anonymous until auth exists", async () => {
    expect(await getSession()).toBeNull();
  });
});
