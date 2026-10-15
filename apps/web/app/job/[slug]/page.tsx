import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatAge } from "@/lib/format";
import { getJobBySlug, type JobDetail, type JobRequirementRow } from "@/lib/job-data";
import {
  evidenceSlice,
  formatSalary,
  isJobSlug,
  monogram,
  safeHttpUrl,
  safeLogoSrc,
  traceRows,
} from "@/lib/job-view";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const job = isJobSlug(slug) ? await getJobBySlug(slug) : null;
  return job ? { title: `${job.title} at ${job.companyName}` } : { title: "Job not found" };
}

const WORKPLACE: Record<string, string> = { remote: "Remote", hybrid: "Hybrid", onsite: "On-site" };
const EMPLOYMENT: Record<string, string> = { fulltime: "Full-time", parttime: "Part-time", contract: "Contract", intern: "Internship" };
const LEVEL: Record<string, string> = { intern: "Intern", entry: "Entry", mid: "Mid", senior: "Senior", lead: "Lead", executive: "Executive" };
const VISA: Record<string, string> = { yes: "Sponsors visas", no: "No visa sponsorship", unknown: "Visa not stated" };
const SALARY_SOURCE: Record<string, string> = { ats_structured: "the board's pay fields", text: "the posting text", llm: "a model reading, checked against the text" };

const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function Logo({ name, logoPath }: { name: string; logoPath: string | null }) {
  const src = safeLogoSrc(logoPath);
  if (src) return <Image src={src} alt="" width={40} height={40} unoptimized className="h-10 w-10 border border-rule bg-sheet object-contain" />;
  return (
    <span
      aria-hidden="true"
      className="inline-flex h-10 w-10 shrink-0 items-center justify-center border border-ink bg-sheet text-[15px] font-extrabold tracking-tight"
    >
      {monogram(name)}
    </span>
  );
}

function Equivalents({ job }: { job: JobDetail }) {
  const s = job.salary;
  const usd = s.currency === "USD" ? null : formatSalary({ minMinor: s.annualUsdMin, maxMinor: s.annualUsdMax, currency: "USD", period: "year" });
  const inr = s.currency === "INR" ? null : formatSalary({ minMinor: s.annualInrMin, maxMinor: s.annualInrMax, currency: "INR", period: "year" });
  if (!usd && !inr) return null;
  return (
    <p className="figure mt-2 text-[13px] text-ink-2" data-testid="salary-equivalents">
      About {[usd, inr].filter(Boolean).join(" or ")}
      {s.fxDate ? `, at the ${s.fxDate} rates` : ""}
    </p>
  );
}

function SalaryBlock({ job }: { job: JobDetail }) {
  const s = job.salary;
  const headline = formatSalary({ minMinor: s.minMinor, maxMinor: s.maxMinor, currency: s.currency, period: s.period });
  const rows = traceRows(s.trace);
  if (!headline) {
    return (
      <section aria-labelledby="pay-h" className="border-t-2 border-rule-strong pt-3">
        <h2 id="pay-h" className="text-[15px] font-semibold">Pay</h2>
        <p className="mt-1 text-ink-3" data-testid="salary-none">Not stated in the posting</p>
      </section>
    );
  }
  return (
    <section aria-labelledby="pay-h" className="border-t-2 border-rule-strong pt-3">
      <h2 id="pay-h" className="text-[15px] font-semibold">Pay</h2>
      <p className="display figure mt-1 text-[32px] leading-tight sm:text-[40px]" data-testid="salary">
        {headline}
      </p>
      <p className="mt-1 text-[13px] text-ink-2">
        {s.kind === "ote" ? "On-target earnings, not base pay. " : ""}
        {s.source ? `Read from ${SALARY_SOURCE[s.source] ?? s.source}.` : ""}
      </p>
      <Equivalents job={job} />
      {rows.length > 0 ? (
        <details className="mt-3 border border-rule bg-sheet" data-testid="salary-trace">
          <summary className="cursor-pointer px-3 py-2 text-[15px] font-semibold text-lane">
            How this was worked out ({rows.length} steps)
          </summary>
          <ol className="border-t border-rule">
            {rows.map((r, i) => (
              <li key={`${r.seq}-${i}`} className="flex gap-3 border-b border-rule px-3 py-2 last:border-b-0" data-step={r.group}>
                <span className="figure w-4 shrink-0 text-[13px] text-ink-3">{i + 1}</span>
                <span className="w-16 shrink-0 text-[13px] font-semibold text-ink-2">{r.group}</span>
                <span className="min-w-0 break-words text-[13px]">{r.label}</span>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </section>
  );
}

function Requirement({ r, text }: { r: JobRequirementRow; text: string | null }) {
  const ev = evidenceSlice(text, r.spanStart, r.spanEnd);
  const meta = [r.category, r.yearsMin !== null ? `${r.yearsMin}+ years` : null].filter(Boolean).join(", ");
  return (
    <li className="border-b border-rule py-2">
      <p className="break-words">{r.text}</p>
      <details className="mt-1">
        <summary className="cursor-pointer text-[13px] text-ink-2">
          Evidence <span className="text-ink-3">({meta})</span>
        </summary>
        {ev ? (
          <p className="mt-1 break-words border-l-4 border-lane pl-3 text-[13px] text-ink-2">
            {ev.before ? <span>…{ev.before}</span> : null}
            <mark className="bg-lane-soft text-ink">{ev.quote}</mark>
            {ev.after ? <span>{ev.after}…</span> : null}
            <span className="figure mt-1 block text-ink-3">
              Description, characters {r.spanStart} to {r.spanEnd}
            </span>
          </p>
        ) : (
          <p className="mt-1 text-[13px] text-ink-3">The source text is not available for this requirement.</p>
        )}
      </details>
    </li>
  );
}

function Requirements({ job }: { job: JobDetail }) {
  const must = job.requirements.filter((r) => r.kind === "must");
  const nice = job.requirements.filter((r) => r.kind === "nice");
  return (
    <section aria-labelledby="req-h" className="mt-8">
      <h2 id="req-h" className="border-b-2 border-rule-strong pb-2 text-[22px] font-extrabold tracking-tight">
        Requirements
      </h2>
      {job.requirements.length === 0 ? (
        <p className="py-3 text-ink-3">No requirements could be read from this posting.</p>
      ) : (
        <>
          <div data-testid="req-must">
            <h3 className="mt-4 text-[15px] font-semibold">
              Must have <span className="figure text-ink-3">({must.length})</span>
            </h3>
            {must.length > 0 ? (
              <ul>{must.map((r, i) => <Requirement key={`m${i}`} r={r} text={job.descriptionText} />)}</ul>
            ) : (
              <p className="py-2 text-ink-3">None stated.</p>
            )}
          </div>
          <div data-testid="req-nice">
            <h3 className="mt-6 text-[15px] font-semibold">
              Nice to have <span className="figure text-ink-3">({nice.length})</span>
            </h3>
            {nice.length > 0 ? (
              <ul>{nice.map((r, i) => <Requirement key={`n${i}`} r={r} text={job.descriptionText} />)}</ul>
            ) : (
              <p className="py-2 text-ink-3">None stated.</p>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-rule py-2">
      <dt className="text-ink-2">{label}</dt>
      <dd className="min-w-0 break-words text-right font-medium">{children}</dd>
    </div>
  );
}

export default async function JobPage({ params }: Props) {
  const { slug } = await params;
  if (!isJobSlug(slug)) notFound();
  const job = await getJobBySlug(slug);
  if (!job) notFound();

  const fresh = job.postedAt ?? job.firstSeenAt;
  const where = job.countries.length > 0 ? job.countries.join(", ") : null;
  const apply = safeHttpUrl(job.applyUrl);

  return (
    <div className="mx-auto w-full max-w-page px-4 py-8 sm:px-8">
      <p className="text-[13px]">
        <Link href="/jobs" className="text-lane">Jobs</Link>
      </p>

      <header className="mt-3 flex items-start gap-3">
        <Logo name={job.companyName} logoPath={job.logoPath} />
        <div className="min-w-0">
          <h1 className="display break-words text-[32px] sm:text-[40px]" data-testid="job-title">{job.title}</h1>
          <p className="mt-1 text-[17px] text-ink-2" data-testid="job-company">{job.companyName}</p>
        </div>
      </header>

      <div className="mt-8 grid gap-8 lg:grid-cols-12">
        <aside className="order-first min-w-0 space-y-6 lg:order-last lg:col-span-4">
          <SalaryBlock job={job} />

          <section aria-labelledby="where-h" className="border-t-2 border-rule-strong pt-3">
            <h2 id="where-h" className="text-[15px] font-semibold">Where and what</h2>
            <dl className="mt-1" data-testid="job-facts">
              <Fact label="Country">{where ?? <span className="text-ink-3">Not stated</span>}</Fact>
              {job.locations.length > 0 ? <Fact label="Locations">{job.locations.join("; ")}</Fact> : null}
              <Fact label="Workplace">
                {job.workplace ? WORKPLACE[job.workplace] ?? job.workplace : <span className="text-ink-3">Not stated</span>}
                {job.remoteScope === "worldwide" ? ", worldwide" : ""}
              </Fact>
              {job.employment ? <Fact label="Type">{EMPLOYMENT[job.employment] ?? job.employment}</Fact> : null}
              {job.level ? <Fact label="Level">{LEVEL[job.level] ?? job.level}</Fact> : null}
              <Fact label="Visa">{VISA[job.visa] ?? job.visa}</Fact>
            </dl>
          </section>

          <section aria-labelledby="fresh-h" className="border-t-2 border-rule-strong pt-3">
            <h2 id="fresh-h" className="text-[15px] font-semibold">Freshness</h2>
            <dl className="figure mt-1" data-testid="job-freshness">
              <Fact label={job.postedAt ? "Posted" : "First seen"}>
                <time dateTime={fresh.toISOString()}>{formatAge(fresh)} ago</time>
                <span className="block text-[13px] font-normal text-ink-3">{dateFmt.format(fresh)}</span>
              </Fact>
              <Fact label="Last checked">
                <time dateTime={job.lastSeenAt.toISOString()}>{formatAge(job.lastSeenAt)} ago</time>
              </Fact>
              {job.closedAt ? <Fact label="Status">Closed {dateFmt.format(job.closedAt)}</Fact> : <Fact label="Status">Open</Fact>}
            </dl>
            {job.source === "fixture" ? <p className="mt-2 text-[13px] text-ink-3">Recorded fixture data, not a live board pull.</p> : null}
          </section>

          {apply && !job.closedAt ? (
            <section className="border-t-2 border-rule-strong pt-3">
              <a
                href={apply}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="inline-block bg-lane px-4 py-2 text-[15px] font-semibold text-white hover:bg-ink"
              >
                Apply on the employer&apos;s site
              </a>
            </section>
          ) : null}
        </aside>

        <div className="min-w-0 lg:col-span-8">
          <section aria-labelledby="skills-h">
            <h2 id="skills-h" className="border-b-2 border-rule-strong pb-2 text-[22px] font-extrabold tracking-tight">Skills</h2>
            {job.skills.length === 0 ? (
              <p className="py-3 text-ink-3">No skills could be read from this posting.</p>
            ) : (
              <ul className="flex flex-wrap gap-2 py-3" data-testid="job-skills">
                {job.skills.map((s) => (
                  <li key={s.id} className="border border-rule bg-sheet px-2 py-0.5 text-[13px] font-medium">{s.label}</li>
                ))}
              </ul>
            )}
          </section>
          <Requirements job={job} />
        </div>
      </div>
    </div>
  );
}
