import type { CriterionVerdict, EligibilityResult, HealthReport } from "@hirelane/engine";

/** Plain-English names for the 9 fixed checks (engine/resume/health.ts). */
const CHECK_TITLE: Record<string, string> = {
  ats_readable: "Hiring software can read it",
  one_page: "Fits on one page",
  contact_present: "Email and phone are on it",
  no_biodata_ids: "No personal details like date of birth",
  no_padding: "No objective or declaration filler",
  bullets_with_numbers: "Points show numbers",
  project_proof_links: "Projects have links",
  skills_in_text: "Skills are backed by your work",
  sensible_file_name: "File name looks professional",
};

function StatusIcon({ status }: { status: "pass" | "fail" | "unknown" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {status === "pass" ? <path d="M5 12l5 5 9-10" /> : status === "fail" ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M6 12h12" />}
    </svg>
  );
}

const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

const STATUS_WORD = { pass: "Passes", fail: "Needs a fix", unknown: "Can't check yet" } as const;

/** "6 of 9 checks pass", failing first with the fix, passing ones folded away. No score out of 100. */
export function ResumeHealth({ report }: { report: HealthReport }) {
  const open = report.checks.filter((c) => c.status !== "pass");
  const passed = report.checks.filter((c) => c.status === "pass");
  return (
    <section className="wr-tile wr-tile-cream wr-health" aria-labelledby="health-h">
      <h2 id="health-h" className="wr-health-h">
        <span className="wr-mid">
          {report.passCount}
          <span>/{report.total}</span>
        </span>
        <span>checks pass</span>
      </h2>
      <ol className="wr-checks">
        {open.map((c) => (
          <li key={c.id} data-status={c.status}>
            <span className="wr-check-icon">
              <StatusIcon status={c.status} />
            </span>
            <div>
              <p className="wr-check-title">
                {CHECK_TITLE[c.id] ?? c.id}
                <span className="sr-only">: {STATUS_WORD[c.status]}</span>
              </p>
              <p className="wr-check-reason">{cap(c.reason)}</p>
              <p className="wr-check-fix">
                <strong>Fix:</strong> {c.fix}
              </p>
            </div>
          </li>
        ))}
      </ol>
      {passed.length > 0 ? (
        <details className="wr-passed">
          <summary>{passed.length} checks already pass</summary>
          <ol className="wr-checks">
            {passed.map((c) => (
              <li key={c.id} data-status="pass">
                <span className="wr-check-icon">
                  <StatusIcon status="pass" />
                </span>
                <p className="wr-check-title">{CHECK_TITLE[c.id] ?? c.id}</p>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </section>
  );
}

const LEVEL_WORD: Record<string, string> = { "10th": "10th", "12th": "12th", diploma: "diploma", ug: "graduation", pg: "post-graduation" };

function ruleLabel(v: CriterionVerdict): string {
  const c = v.criterion;
  switch (c.type) {
    case "min_score": {
      const where = c.throughout ? "10th, 12th and graduation" : c.levels.map((l) => LEVEL_WORD[l] ?? l).join(", ");
      return `${c.pct}%${c.cgpa ? ` or ${c.cgpa} CGPA` : ""} in ${where}`;
    }
    case "no_active_backlogs":
      return "No active backlogs";
    case "max_backlog_history":
      return c.n === 0 ? "No backlogs ever" : `At most ${c.n} backlog${c.n === 1 ? "" : "s"} in total`;
    case "passout_years":
      return `${c.years.join(" or ")} passout`;
    case "degrees":
      return c.list.join(", ");
    case "branches":
      return `Branch: ${c.list.join(", ")}`;
    case "max_gap_years":
      return c.n === 0 ? "No gap in education" : `Education gap of at most ${c.n} year${c.n === 1 ? "" : "s"}`;
  }
}

const OVERALL = {
  pass: { title: "You qualify", tone: "lime" },
  fail: { title: "Not this one", tone: "pink" },
  unknown: { title: "We couldn't check everything", tone: "sun" },
} as const;

/** Per-rule verdict for a job or drive. Unknown is shown plainly and never treated as a no. */
export function EligibilityVerdict({ result, roleLabel }: { result: EligibilityResult; roleLabel: string }) {
  const head = OVERALL[result.overall];
  return (
    <section className={`wr-tile wr-tile-${head.tone}`} aria-labelledby="elig-h">
      <p className="wr-tile-label">{roleLabel}</p>
      <h2 id="elig-h" className="wr-paste-title">
        {head.title}
      </h2>
      <ol className="wr-checks">
        {result.verdicts.map((v, i) => (
          <li key={i} data-status={v.status}>
            <span className="wr-check-icon">
              <StatusIcon status={v.status} />
            </span>
            <div>
              <p className="wr-check-title">
                {ruleLabel(v)}
                <span className="sr-only">: {v.status === "pass" ? "you meet it" : v.status === "fail" ? "you don't meet it" : "can't check"}</span>
              </p>
              <p className="wr-check-reason">{cap(v.reason)}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
