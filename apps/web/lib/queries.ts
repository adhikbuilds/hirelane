// Stub: replaced by Drizzle queries once packages/db and ingest land (Phase 1/3).
export type LedgerJob = {
  id: string;
  title: string;
  company: string;
  where: string;
  postedAt: Date;
  source: "gh" | "lv" | "ab";
};

export type FreshestJobs = {
  jobs: LedgerJob[];
  refreshedAt: Date | null;
  boards: number;
};

export async function getFreshestJobs(_limit: number): Promise<FreshestJobs> {
  return { jobs: [], refreshedAt: null, boards: 0 };
}
