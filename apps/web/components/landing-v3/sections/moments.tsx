import { getLandingSnapshot } from "@/lib/queries/landing";
import { getTopCompanies } from "./data";
import { MomentsPanels } from "./moments-panels";

/** Three spatial panels with live data. Server component: reads the cached landing snapshot and the top companies. */
export async function Moments() {
  const [snap, companies] = await Promise.all([getLandingSnapshot(), getTopCompanies()]);
  return (
    <MomentsPanels
      ticker={snap.ticker}
      openJobs={snap.counts.openJobs}
      companies={companies}
      totalCompanies={snap.counts.companies}
      initialPerWeek={snap.autopilot?.perWeek ?? null}
      nowIso={new Date().toISOString()}
    />
  );
}
