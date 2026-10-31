"use client";

import Link from "next/link";
import { useState } from "react";
import { postJson } from "@/lib/student/client";

/** "I got an interview" / "I got an offer": a student-reported outcome, kept until their placement cell verifies it. */
export function OutcomeButtons({ employer, role, sample, inline = false }: { employer: string; role: string; sample: boolean; inline?: boolean }) {
  const [state, setState] = useState<{ kind: "ok" | "join" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function send(kind: "interview" | "offer") {
    if (sample) {
      setState({ kind: "ok", text: "Sample student: nothing was saved." });
      return;
    }
    setBusy(true);
    const r = await postJson("/api/v1/campus/outcomes", { kind, employer, roleTitle: role });
    setBusy(false);
    if (r.ok) setState({ kind: "ok", text: "Saved. Your placement cell sees it only if you share outcomes with them." });
    else if (r.error === "not_in_campus") setState({ kind: "join", text: "Outcomes go to your placement cell, so join your college first." });
    else setState({ kind: "err", text: "That didn’t save. Try again in a moment." });
  }
  if (inline)
    return (
      <div className="st-msg-out" style={{ gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="st-btn" style={{ ["--h" as string]: "44px" }} disabled={busy} onClick={() => void send("interview")}>
          I got an interview
        </button>
        <button type="button" className="st-btn" style={{ ["--h" as string]: "44px" }} disabled={busy} onClick={() => void send("offer")}>
          I got an offer
        </button>
        {state ? (
          <p className={state.kind === "err" ? "st-err" : "st-note"} role="status" style={{ flexBasis: "100%" }}>
            {state.text}
          </p>
        ) : null}
      </div>
    );
  return (
    <div style={{ borderTop: "1px solid var(--line)", paddingTop: 14, display: "grid", gap: 8 }}>
      <button type="button" className="st-btn st-full" disabled={busy} onClick={() => void send("interview")}>
        I got an interview
      </button>
      <button type="button" className="st-btn st-full" disabled={busy} onClick={() => void send("offer")}>
        I got an offer
      </button>
      {state ? (
        <p className={state.kind === "err" ? "st-err" : "st-note"} role="status">
          {state.text}{" "}
          {state.kind === "join" ? (
            <Link href="/welcome/college" style={{ color: "var(--ink)" }}>
              Join your college
            </Link>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
