"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { postJson, putJson } from "@/lib/student/client";

const Bars = ({ on }: { on: number }) => (
  <div className="st-au-prog" aria-label={`Step ${on} of 5`}>
    {[1, 2, 3, 4, 5].map((n) => (
      <i key={n} className={n <= on ? "st-on" : undefined} />
    ))}
  </div>
);

/** Step 4 of 5: the student chooses whether tapping Apply applies for them. Either answer moves on; it can be changed any time. */
export function ApplyStep({ pilot, address, sample }: { pilot: boolean; address: string | null; sample: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"on" | "off" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function choose(granted: boolean) {
    setError(null);
    if (!sample) {
      setBusy(granted ? "on" : "off");
      const r = await putJson("/api/v1/apply/consent", { granted });
      setBusy(null);
      if (!r.ok) {
        setError("That didn’t save. Try again in a moment.");
        return;
      }
    }
    router.push("/welcome/college");
  }

  return (
    <div className="st-au-main">
      <div>
        <h1 className="st-au-h">{pilot ? "Tap Apply, and we apply." : "Tap Get it ready, and it’s ready."}</h1>
        <p className="st-au-sub">Step 4 of 5. You can change this any time in Settings.</p>
      </div>
      <div className="st-au-card-w">
        <div className="st-au-card">
          <Bars on={4} />
          <h2>{pilot ? "When you tap Apply, Hirelane applies for you." : "When you tap Get it ready, Hirelane gets your application ready."}</h2>
          <p>
            {pilot
              ? "Hirelane fills in the company’s form from your resume and your answers, and sends it from your Hirelane address. Replies come to your inbox here. If a site blocks us, you finish it there with everything ready. You’ll see a receipt for every application."
              : "Hirelane fills in the company’s form from your resume and your answers, ready to send from your Hirelane address. You press submit on their site. Replies come to your inbox here."}
          </p>
          {address ? <div className="st-au-addr">{address}</div> : <p className="st-au-note">Your Hirelane address is made when you continue.</p>}
          <button type="button" className="st-au-btn" disabled={busy !== null} onClick={() => void choose(true)}>
            {pilot ? "Turn on Apply" : "Use my Hirelane address"}
          </button>
          <button type="button" className="st-au-btn st-o" disabled={busy !== null} onClick={() => void choose(false)}>
            I’ll submit myself
          </button>
          {error ? (
            <p className="st-au-err" role="alert">
              {error}
            </p>
          ) : null}
          <Link className="st-au-link" href="/you">
            What Hirelane never does
          </Link>
        </div>
      </div>
    </div>
  );
}

type Level = "aggregate" | "outcomes" | "full";
const LEVELS: { id: Level; title: string; text: string }[] = [
  { id: "aggregate", title: "Totals only", text: "You’re counted in totals. Nothing about you by name." },
  { id: "outcomes", title: "Outcomes", text: "They also see your interview and offer status, so they can verify an offer for NAAC." },
  { id: "full", title: "Full (fields you pick)", text: "Outcomes, plus the profile fields you choose. Never your marks unless you pick them." },
];
interface Cohort {
  id: string;
  passoutYear: number;
  programme: string;
}

/** Step 5 of 5: join the college with a campus code (or the college email), and choose what the placement cell sees. Skippable. */
export function CollegeStep({ sample, joined }: { sample: boolean; joined: boolean }) {
  const router = useRouter();
  const [tab, setTab] = useState<"email" | "code">("email");
  const [email, setEmail] = useState(sample ? "rahul.v26@sampleuni.ac.in" : "");
  const [code, setCode] = useState("");
  const [otp, setOtp] = useState("");
  const [sent, setSent] = useState(false);
  const [level, setLevel] = useState<Level>("aggregate");
  const [cohorts, setCohorts] = useState<Cohort[] | null>(null);
  const [cohortId, setCohortId] = useState("");
  const [campus, setCampus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fail = (e: string | null) =>
    setError(
      ({
        invalid_code: "That code didn’t work. Check it and try again.",
        rate_limited: "Too many tries. Wait a few minutes and try again.",
        invalid_email: "That doesn’t look like an email address.",
        not_found: "We couldn’t find that. Check it and try again.",
        mail_unavailable: "We couldn’t send the email just now. Try the campus code instead.",
        already_member: "You’ve already joined a college.",
        conflict: "You’ve already joined a college.",
      } as Record<string, string>)[e ?? ""] ?? "That didn’t work. Try again in a moment.",
    );

  async function finish() {
    if (!sample) {
      const r = await putJson("/api/v1/campus/share", { level });
      if (!r.ok) {
        fail(r.error);
        return;
      }
    }
    router.push("/home");
  }

  async function join() {
    setError(null);
    if (sample) return router.push("/home");
    setBusy(true);
    if (tab === "code") {
      if (!cohortId) {
        const r = await postJson<{ status: string; campus?: { name: string }; cohorts?: Cohort[] }>("/api/v1/campus/join", { code: code.trim() });
        setBusy(false);
        if (!r.ok) return fail(r.error);
        if (r.data?.status === "choose_cohort" && r.data.cohorts) {
          setCohorts(r.data.cohorts);
          setCampus(r.data.campus?.name ?? null);
          if (r.data.cohorts.length === 1) setCohortId(r.data.cohorts[0]!.id);
        } else await finish();
        return;
      }
      const r = await postJson("/api/v1/campus/join", { code: code.trim(), cohortId });
      setBusy(false);
      if (!r.ok) return fail(r.error);
      await finish();
      return;
    }
    if (!sent) {
      const r = await postJson("/api/v1/campus/join/email", { email: email.trim() });
      setBusy(false);
      if (!r.ok) return fail(r.error);
      setSent(true);
      return;
    }
    if (!cohortId) {
      setBusy(false);
      setError("Choose your batch first: check your campus code on the Campus code tab.");
      return;
    }
    const r = await postJson("/api/v1/campus/join/email/verify", { email: email.trim(), code: otp.trim(), cohortId });
    setBusy(false);
    if (!r.ok) return fail(r.error);
    await finish();
  }

  const label = sample ? "Join" : tab === "code" ? (cohorts && !cohortId ? "Check your batch" : cohortId ? "Join" : "Check the code") : sent ? "Join" : "Send me a code";
  return (
    <div className="st-au-main">
      <div>
        <h1 className="st-au-h">See your college’s drives.</h1>
        <p className="st-au-sub">Step 5 of 5. Your placement cell’s drives show up next to your picks. You can skip this.</p>
      </div>
      <div className="st-au-card-w">
        <div className="st-au-card">
          <Bars on={5} />
          <h2>{joined ? "You’ve joined your college" : "Join your college"}</h2>
          {joined ? (
            <>
              <p>Its drives show next to your picks.</p>
              <Link className="st-au-btn" href="/home">
                Continue
              </Link>
            </>
          ) : (
            <>
              <div className="st-au-tabs" role="tablist" aria-label="How to join">
                <button type="button" role="tab" aria-selected={tab === "email"} className={tab === "email" ? "st-on" : undefined} onClick={() => setTab("email")}>
                  College email
                </button>
                <button type="button" role="tab" aria-selected={tab === "code"} className={tab === "code" ? "st-on" : undefined} onClick={() => setTab("code")}>
                  Campus code
                </button>
              </div>
              {tab === "email" ? (
                <>
                  <label htmlFor="ce">College email</label>
                  <input className="st-au-in-field" id="ce" type="email" autoComplete="email" placeholder="you@yourcollege.ac.in" value={email} onChange={(e) => setEmail(e.target.value)} />
                  {sent ? (
                    <>
                      <label htmlFor="otp">The 6-digit code we sent</label>
                      <input className="st-au-in-field" id="otp" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value)} />
                    </>
                  ) : null}
                </>
              ) : (
                <>
                  <label htmlFor="cc">Campus code</label>
                  <input className="st-au-in-field" id="cc" autoComplete="off" autoCapitalize="characters" placeholder="From your placement cell" value={code} onChange={(e) => setCode(e.target.value)} />
                </>
              )}
              {cohorts ? (
                <fieldset className="st-au-cohorts" style={{ border: 0 }}>
                  <legend style={{ fontWeight: 600, fontSize: 14, marginBottom: 6 }}>{campus ? `Your batch at ${campus}` : "Your batch"}</legend>
                  {cohorts.map((c) => (
                    <label key={c.id} className={`st-au-opt${cohortId === c.id ? " st-on" : ""}`}>
                      <input className="st-vh" type="radio" name="cohort" checked={cohortId === c.id} onChange={() => setCohortId(c.id)} />
                      <span className="st-rad" />
                      <span>
                        <b>{c.programme}</b>
                        <span>Batch of {c.passoutYear}</span>
                      </span>
                    </label>
                  ))}
                </fieldset>
              ) : null}
              <fieldset className="st-au-cohorts" style={{ border: 0 }}>
                <legend style={{ fontWeight: 600, fontSize: 14, marginBottom: 6 }}>What your placement cell sees</legend>
                {LEVELS.map((l) => (
                  <label key={l.id} className={`st-au-opt${level === l.id ? " st-on" : ""}`}>
                    <input className="st-vh" type="radio" name="level" checked={level === l.id} onChange={() => setLevel(l.id)} />
                    <span className="st-rad" />
                    <span>
                      <b>{l.title}</b>
                      <span>{l.text}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
              <button type="button" className="st-au-btn" disabled={busy || (tab === "code" ? code.trim().length === 0 : email.trim().length < 3) || (cohorts !== null && !cohortId)} onClick={() => void join()}>
                {label}
              </button>
              {error ? (
                <p className="st-au-err" role="alert">
                  {error}
                </p>
              ) : null}
              <Link className="st-au-link" href="/home">
                Skip, I’m not with a college on Hirelane
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
