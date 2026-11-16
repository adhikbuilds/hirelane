"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { postJson, putJson } from "@/lib/student/client";
import type { AnswerView, FinishView as Finish, NeedsCode } from "@/lib/student/types";
import { CopyButton } from "./CopyButton";
import { Ic } from "./Icon";

const MONO = /@/;

/** An email address wraps at its dots and the @ instead of pushing the Copy button off a phone. */
const breakable = (v: string) =>
  v.split(/(?<=[.@])/).flatMap((part, i) => (i === 0 ? [part] : [<wbr key={i} />, part]));

/**
 * "Their site needs you": the application stopped, nothing was sent, and every answer is ready to copy. The student
 * finishes on the company's own form and tells us, or answers what only they can and sends it again (rearm).
 */
export function FinishView({ finish, sample, codes = [] }: { finish: Finish; sample: boolean; codes?: NeedsCode[] }) {
  const router = useRouter();
  const [copied, setCopied] = useState<Set<string>>(new Set());
  const [values, setValues] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const answers = finish.answers.map((a) => ({ ...a, value: saved[a.key] ?? a.value }));
  const have = answers.filter((a) => a.value);
  const owed = answers.filter((a) => a.needsYou && !a.value);
  const done = have.filter((a) => copied.has(a.key)).length;
  const rearmable = finish.needsAnswers > 0;

  async function save(a: AnswerView) {
    const answer = (values[a.key] ?? "").trim();
    if (!answer) return;
    if (sample) {
      setSaved((s) => ({ ...s, [a.key]: answer }));
      return;
    }
    setBusy(a.key);
    const r = await putJson("/api/v1/apply/answers", { questionKey: a.key, answer, labelSeen: a.label });
    setBusy(null);
    if (r.ok) setSaved((s) => ({ ...s, [a.key]: answer }));
    else setMsg({ kind: "err", text: "That answer didn’t save. Try again in a moment." });
  }

  async function finishNow() {
    if (sample) return setMsg({ kind: "ok", text: "Sample student: nothing was changed." });
    setBusy("finish");
    const r = await postJson(`/api/v1/apply/applications/${finish.id}/finish`);
    setBusy(null);
    if (r.ok) router.push("/tracker");
    else setMsg({ kind: "err", text: r.status === 409 ? "This one can’t be marked as submitted from here." : "That didn’t save. Try again in a moment." });
  }

  async function sendAgain() {
    if (sample) return setMsg({ kind: "ok", text: "Sample student: nothing was changed." });
    setBusy("rearm");
    const r = await postJson(`/api/v1/apply/applications/${finish.id}/rearm`);
    setBusy(null);
    if (r.ok) router.push("/tracker");
    else setMsg({ kind: "err", text: r.status === 409 ? "It can only be sent again once every question has an answer." : "That didn’t go through. Try again in a moment." });
  }

  return (
    <>
      <div className="st-a-head">
        <Link className="st-tlink" href="/tracker" style={{ fontSize: 14, color: "var(--ink-2)" }}>
          Tracker
        </Link>
        <h1 className="st-a-title" style={{ marginTop: 8 }}>
          {finish.company}’s site needs you
        </h1>
        <p className="st-a-count">{finish.reason}</p>
        {sample ? <p className="st-sample">Sample student</p> : null}
      </div>
      <div className="st-ny">
        <div className="st-panel st-ny-ans">
          <div style={{ padding: 16, display: "grid", gap: 4 }}>
            <div className="st-c-h">{finish.role}</div>
            <div className="st-small">{finish.company}</div>
            {have.length > 0 ? (
              <>
                <div className="st-small st-num" style={{ marginTop: 8 }} aria-live="polite">
                  {done} of {have.length} copied
                </div>
                <div className="st-prog">
                  <i style={{ "--v": have.length ? done / have.length : 0 } as React.CSSProperties} />
                </div>
              </>
            ) : null}
          </div>
          <div className="st-stepper" style={{ borderTop: "1px solid var(--line)" }}>
            {answers.length === 0 ? (
              <div className="st-emptyrow">No answers were filled before it stopped. Open the form and answer there.</div>
            ) : null}
            {answers.map((a, n) => {
              const ok = copied.has(a.key);
              return (
                <div key={a.key} className={`st-srow${ok ? " st-done" : ""}`}>
                  <span className="st-n">{ok ? "✓" : n + 1}</span>
                  <span className="st-lab">{a.label}</span>
                  {a.value ? (
                    <>
                      <span className={`st-val${MONO.test(a.value) && a.value.length < 40 ? " st-mono st-em" : ""}`} style={a.value.length > 60 ? { fontWeight: 400 } : undefined}>
                        {MONO.test(a.value) && a.value.length < 40 ? breakable(a.value) : a.value}
                      </span>
                      <CopyButton text={a.value} onCopied={() => setCopied((s) => new Set(s).add(a.key))} aria={`Copy ${a.label}`} done="Copied" />
                    </>
                  ) : (
                    <span className="st-val" style={{ fontWeight: 400, gridColumn: "2 / span 2" }}>
                      {a.suggestion ? <span className="st-small" style={{ display: "block", marginBottom: 6 }}>A draft to start from: {a.suggestion}</span> : null}
                      {a.answerable ? (
                        <span style={{ display: "grid", gap: 8 }}>
                          <textarea
                            className="st-input"
                            aria-label={a.label}
                            value={values[a.key] ?? a.suggestion ?? ""}
                            onChange={(e) => setValues((v) => ({ ...v, [a.key]: e.target.value }))}
                            style={{ minHeight: 80 }}
                          />
                          <span>
                            <button type="button" className="st-btn st-sm" disabled={busy === a.key} onClick={() => void save(a)}>
                              Save answer
                            </button>
                          </span>
                        </span>
                      ) : (
                        <span className="st-small">Only you can answer this one on their form.</span>
                      )}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="st-panel st-ny-fin" style={{ padding: 16, display: "grid", gap: 12 }}>
          <div className="st-c-h">{!rearmable ? "Finish on their site" : owed.length > 0 ? "Answer, then send again" : "Your answers are in"}</div>
          {rearmable ? (
            <>
              <p className="st-ink2" style={{ fontSize: 14 }}>
                {owed.length > 0
                  ? `${owed.length} ${owed.length === 1 ? "question needs" : "questions need"} you. Once each has an answer, we can send it again.`
                  : "Every question has an answer. We can send it again, or you can finish on their site."}
              </p>
              <button type="button" className="st-btn st-p st-full" style={{ ["--h" as string]: "44px" }} disabled={busy === "rearm" || owed.length > 0} onClick={() => void sendAgain()}>
                Send it again
              </button>
            </>
          ) : (
            <p className="st-ink2" style={{ fontSize: 14 }}>
              Sign in on {finish.company}’s careers site, then paste each answer.
            </p>
          )}
          {finish.host ? (
            <div className="st-mono st-small" style={{ overflowWrap: "anywhere" }}>
              {finish.host}
            </div>
          ) : null}
          {finish.url ? (
            <a className={`st-btn ${rearmable ? "" : "st-p "}st-full`} style={{ ["--h" as string]: "44px" }} href={finish.url} target="_blank" rel="noopener noreferrer">
              Open {finish.company}’s form
              <Ic name="ext" small />
            </a>
          ) : (
            <p className="st-small">We don’t have a link to their form. Find the role on their careers page.</p>
          )}
          <button type="button" className="st-btn st-full" style={{ ["--h" as string]: "44px" }} disabled={busy === "finish"} onClick={() => void finishNow()}>
            I’ve submitted it
          </button>
          {msg ? (
            <p className={msg.kind === "err" ? "st-err" : "st-note"} role="status">
              {msg.text}
            </p>
          ) : null}
        </div>

        {codes.length > 0 ? (
          <div className="st-panel st-rows st-ny-also">
            <div className="st-grp" style={{ padding: "14px 16px 4px", fontSize: 13, color: "var(--ink-2)", fontWeight: 500 }}>
              Also needs you
            </div>
            {codes.map((c) => (
              <div className="st-rowlink" key={c.id}>
                <div className="st-rl-main">
                  <div className="st-rl-t">Security code from {c.from}</div>
                  <div className="st-code st-num" style={{ margin: "6px 0 4px" }}>
                    {c.code}
                  </div>
                  <div className="st-rl-m">{c.note}</div>
                </div>
                <CopyButton text={c.code.replace(/\s/g, "")} aria="Copy code" />
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </>
  );
}
