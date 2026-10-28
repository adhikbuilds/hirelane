import Link from "next/link";
import { Button } from "@/components/shadcn/button";
import { Card, CardDescription, CardTitle } from "@/components/shadcn/card";
import type { EligibilityResult } from "@hirelane/engine";
import { EligibilityVerdict } from "./ResumeHealth";

export type ScamSignal = { label: string; quote: string };

/** Paste a job: the student brings any posting; we parse it, check eligibility and scam signs. We never open the link. */
export function PasteJob({
  text,
  parsed,
  eligibility,
  scam,
}: {
  text: string;
  parsed: { role: string; company: string; place: string } | null;
  eligibility: EligibilityResult | null;
  scam: ScamSignal[];
}) {
  return (
    <>
      <Card aria-labelledby="pastebox-h">
        <CardTitle id="pastebox-h">Paste a job</CardTitle>
        <CardDescription>From Naukri, LinkedIn, a WhatsApp forward or a college notice board. We read the text only; we never open the link.</CardDescription>
        <form className="acct-stack-y" action="#">
          <label className="text-[0.9375rem] font-bold" htmlFor="jobtext">
            Job text
          </label>
          <textarea id="jobtext" name="jobtext" rows={6} defaultValue={text} className="wr-textarea" />
          <Button type="submit" variant="lime" size="pill">
            Check this job
          </Button>
        </form>
      </Card>

      {scam.length > 0 ? (
        <section className="wr-tile wr-tile-pink" aria-labelledby="scam-h">
          <h2 id="scam-h" className="wr-paste-title">
            This looks like a scam
          </h2>
          <ul className="wr-checks">
            {scam.map((s) => (
              <li key={s.label} data-status="fail">
                <span className="wr-check-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                    <path d="M12 7v6M12 17h.01" />
                  </svg>
                </span>
                <div>
                  <p className="wr-check-title">{s.label}</p>
                  <p className="wr-check-reason">&quot;{s.quote}&quot;</p>
                </div>
              </li>
            ))}
          </ul>
          <p className="wr-tile-fix">Real employers never charge you to apply or to send an offer letter. Don&apos;t pay. Tell your placement cell.</p>
        </section>
      ) : null}

      {parsed && eligibility && scam.length === 0 ? (
        <>
          <section className="wr-tile wr-tile-cream" aria-labelledby="parsed-h">
            <h2 id="parsed-h" className="wr-paste-title">
              {parsed.role}
            </h2>
            <p className="wr-tile-fix">
              {parsed.company}, {parsed.place}
            </p>
            <p className="wr-safe-line">No warning signs: no fee asked, no Telegram-only contact.</p>
          </section>
          <EligibilityVerdict result={eligibility} roleLabel={`${parsed.role}, ${parsed.company}`} />
          <div className="wr-drive-actions">
            <Button asChild variant="lime" size="pill-sm">
              <Link href="#">Add to my Tracker</Link>
            </Button>
            <Button asChild variant="on-night" size="pill-sm">
              <Link href="#">Apply on their site</Link>
            </Button>
          </div>
        </>
      ) : null}
    </>
  );
}

export type WarmCompany = { company: string; hiring: string; people: { initials: string; title: string }[] };

/** Who you know: matches the student's own uploaded LinkedIn connections to companies hiring now. Private to them. */
export function Network({
  uploaded,
  companies,
  draftFor,
  stage = "start",
}: {
  uploaded: boolean;
  companies: WarmCompany[];
  draftFor: WarmCompany | null;
  stage?: "start" | "requested" | "ready";
}) {
  if (!uploaded) {
    const steps = [
      {
        title: "Ask LinkedIn for your file",
        text: "Opens LinkedIn's download page. Tick Connections, then Request archive.",
        action: (
          <Button asChild variant="lime" size="pill-sm">
            <a href="https://www.linkedin.com/mypreferences/d/download-my-data" target="_blank" rel="noopener noreferrer">
              Open LinkedIn&apos;s download page
            </a>
          </Button>
        ),
      },
      { title: "Wait for LinkedIn's email", text: "Usually about 10 minutes. We'll remind you here.", action: null },
      {
        title: "Upload the file",
        text: "The ZIP or Connections.csv. It stays private to you.",
        action: (
          <form className="acct-stack-y" action="#">
            <input type="file" accept=".zip,.csv" className="wr-file" aria-label="LinkedIn connections file" />
            <Button type="submit" variant="lime" size="pill-sm">
              Upload my connections
            </Button>
          </form>
        ),
      },
    ];
    const current = stage === "requested" ? 1 : stage === "ready" ? 2 : 0;
    return (
      <Card aria-labelledby="net-h">
        <CardTitle id="net-h">See who you know at each company</CardTitle>
        <CardDescription>Three steps, about 15 minutes. Your college and other students never see your connections.</CardDescription>
        <ol className="wr-lock-steps">
          {steps.map((st, i) => {
            const state = i < current ? "done" : i === current ? "now" : "locked";
            return (
              <li key={st.title} data-state={state}>
                <span className="wr-lock-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    {state === "done" ? (
                      <path d="M5 12l5 5 9-10" />
                    ) : state === "locked" ? (
                      <path d="M7 11V8a5 5 0 0110 0v3M6 11h12v10H6z" />
                    ) : (
                      <path d="M9 6l6 6-6 6" />
                    )}
                  </svg>
                </span>
                <div>
                  <p className="wr-check-title">
                    {st.title}
                    <span className="sr-only">: {state === "done" ? "done" : state === "now" ? "do this now" : "locked until the step before is done"}</span>
                  </p>
                  <p className="wr-check-reason">{state === "locked" ? `Unlocks after step ${i}.` : st.text}</p>
                  {state === "now" && st.action ? <div className="wr-lock-action">{st.action}</div> : null}
                  {state === "now" && i === 1 ? (
                    <form action="#" className="wr-lock-action">
                      <Button type="submit" variant="outline" size="pill-sm">
                        I&apos;ve got the email
                      </Button>
                    </form>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      </Card>
    );
  }
  return (
    <>
      <section className="wr-tile wr-tile-lime" aria-labelledby="net-h">
        <h2 id="net-h" className="wr-paste-title">
          You know people at {companies.length} companies hiring now
        </h2>
        <ul className="wr-warm-list wr-warm-big">
          {companies.map((c) => (
            <li key={c.company}>
              <span className="wr-faces" aria-hidden="true">
                {c.people.map((p) => (
                  <span key={p.initials}>{p.initials}</span>
                ))}
              </span>
              <span>
                <b>{c.company}</b>
                <br />
                <small>
                  {c.people.length} {c.people.length === 1 ? "connection" : "connections"}; hiring {c.hiring}
                </small>
              </span>
            </li>
          ))}
        </ul>
        <p className="wr-tile-fix">From your own LinkedIn file. Only you can see this.</p>
      </section>
      {draftFor ? (
        <Card aria-labelledby="draft-h">
          <CardTitle id="draft-h">Ask for a referral at {draftFor.company}</CardTitle>
          <CardDescription>A draft you can edit. You send it yourself from LinkedIn, WhatsApp or email; Hirelane never sends it.</CardDescription>
          <p className="wr-draft">
            Hi, I hope you&apos;re doing well. I&apos;m finishing my B.Com this year and saw {draftFor.company} is hiring a {draftFor.hiring}. I&apos;ve
            handled billing and Excel reports in my project work. Would you be open to referring me, or telling me who the right person is? Happy to
            share my resume. Thank you!
          </p>
          <div className="wr-drive-actions">
            <Button type="button" variant="lime" size="pill-sm">
              Copy the message
            </Button>
            <Button asChild variant="outline" size="pill-sm">
              <Link href="#">Open LinkedIn</Link>
            </Button>
          </div>
        </Card>
      ) : null}
    </>
  );
}
