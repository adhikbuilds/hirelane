"use client";

import { useState } from "react";
import { postJson } from "@/lib/student/client";
import { pasteView } from "@/lib/student/map";
import type { PasteView } from "@/lib/student/types";
import type { PasteResult } from "@hirelane/services";
import { GLYPH } from "./RoleCard";

/** The sample answer a development build shows without calling the service, so the screen can be reviewed signed out. */
const SAMPLE_VIEW: PasteView = {
  title: "Claims Associate, Neelgiri Insurance Brokers",
  headline: "You don’t meet 1 of 4 rules",
  rules: [
    { status: "fail", text: "12th: 58%, needs 60%" },
    { status: "pass", text: "B.Com, 2026 passout" },
    { status: "pass", text: "10th: 71%, needs 55%" },
    { status: "pass", text: "Active backlogs: 0, needs none" },
  ],
  pay: "Pay not stated",
  fit: "3 of 4 must-haves",
  scam: null,
};

const ERRORS: Record<string, string> = {
  rate_limited: "That’s a lot of pastes in a short time. Wait a few minutes and try again.",
  validation_failed: "Paste the whole post, at least a couple of lines.",
  network: "We couldn’t reach Hirelane. Check your connection and try again.",
};

/** Paste a job from WhatsApp, a job site or anywhere: eligibility with the maths, must-haves and a scam check. Nothing is saved and the link is never opened. */
export function PasteForm({ sample }: { sample: boolean }) {
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<PasteView | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (text.trim().length < 20) {
      setError(ERRORS["validation_failed"]!);
      return;
    }
    if (sample) {
      setView(SAMPLE_VIEW);
      return;
    }
    setBusy(true);
    const r = await postJson<PasteResult>("/api/v1/paste", { text: text.trim(), ...(url.trim() ? { url: url.trim() } : {}) });
    setBusy(false);
    if (r.ok && r.data) setView(pasteView(r.data));
    else {
      setView(null);
      setError(ERRORS[r.error ?? ""] ?? "That didn’t work. Try again in a moment.");
    }
  }

  return (
    <div className="st-paste">
      <form className="st-panel st-form" style={{ padding: 20 }} onSubmit={(e) => void submit(e)} noValidate>
        <div className="st-field">
          <label htmlFor="paste-text">Job post or drive notice</label>
          <textarea className="st-input" id="paste-text" value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste the whole post here" style={{ minHeight: 200 }} />
          <p className="st-hint">A WhatsApp forward, a listing from a job site, a notice from your placement cell.</p>
        </div>
        <div className="st-field">
          <label htmlFor="paste-url">Link, if there is one</label>
          <input className="st-input" id="paste-url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />
          <p className="st-hint">We read the link as text. We never open it.</p>
        </div>
        <div>
          <button className="st-btn st-p" style={{ ["--h" as string]: "44px" }} type="submit" disabled={busy}>
            {busy ? "Checking" : "Check this job"}
          </button>
        </div>
        {error ? (
          <p className="st-err" role="alert">
            {error}
          </p>
        ) : null}
        <div className="st-privacy st-note">Nothing you paste is saved.</div>
      </form>

      <div aria-live="polite">
        {view ? (
          <div className="st-panel" style={{ padding: 20, display: "grid", gap: 14 }}>
            <div>
              <div className="st-small">Your check</div>
              <h2 style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-.01em", marginTop: 2 }}>{view.title}</h2>
            </div>
            {view.scam ? (
              <div className="st-warn" role="alert">
                <b>{view.scam.title}</b>
                {view.scam.quotes.map((q) => (
                  <span key={q}>“{q}”</span>
                ))}
                <span>Real employers don’t ask you to pay to apply. Don’t send money or documents.</span>
              </div>
            ) : null}
            <div className="st-result">
              <div className="st-vhead">{view.headline}</div>
              {view.rules.map((r) => (
                <div className="st-vrow" key={r.text}>
                  <span className={`st-glyph ${GLYPH[r.status].cls}`}>{GLYPH[r.status].mark}</span>
                  <span>{r.text}</span>
                </div>
              ))}
            </div>
            <dl className="st-kv">
              <dt>Pay</dt>
              <dd>{view.pay}</dd>
              <dt>Must-haves</dt>
              <dd>{view.fit}</dd>
            </dl>
          </div>
        ) : (
          <div className="st-panel" style={{ padding: 20, display: "grid", gap: 8 }}>
            <div className="st-c-h">What you get back</div>
            <p className="st-ink2">Each rule in the post, checked against your marks with the maths shown. Then the must-haves you meet, and a note if it looks like a scam.</p>
          </div>
        )}
      </div>
    </div>
  );
}
