"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { OfferRow } from "@/lib/sample/campus";
import { callBlob, callJson, messageFor, saveBlob } from "@/lib/campus-client";
import { Icon } from "./Console";

const NAAC_CAVEAT =
  "The columns follow the public description of the NAAC 5.2.1 template and have not been checked against the official template for the current cycle. Check them before your college files. A README with this note downloads next to the file.";

/** The NAAC 5.2.1 file. The download is the audited action (one POST); the README with the caveat is saved with it. */
export function NaacDownload({ sample }: { sample: boolean }) {
  const [state, setState] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function download() {
    if (sample) return setState({ kind: "ok", text: "Sample: nothing was downloaded." });
    setBusy(true);
    setState(null);
    const file = await callBlob("/api/v1/tpo/export/naac", { method: "POST", idempotent: false });
    if (!file.ok || !file.data) {
      setBusy(false);
      return setState({ kind: "err", text: messageFor(file.error) });
    }
    const stamp = new Date().toISOString().slice(0, 10);
    saveBlob(file.data, `naac-5.2.1-${stamp}.csv`);
    const readme = await callBlob("/api/v1/tpo/export/naac?format=readme");
    if (readme.ok && readme.data) saveBlob(readme.data, `naac-5.2.1-README-${stamp}.txt`);
    setBusy(false);
    setState({
      kind: "ok",
      text: readme.ok
        ? "Downloaded the list and its README. Each student in it can see this in their own account."
        : "Downloaded the list, but the README did not download. Read the caveat above before filing.",
    });
  }

  return (
    <div>
      <button className="cp-btn" type="button" disabled={busy} onClick={() => void download()}>
        <Icon d="M12 4v11m0 0l-4-4m4 4l4-4M5 20h14" />
        Download 5.2.1 list (CSV)
      </button>
      <p className="cp-card-sub">{NAAC_CAVEAT}</p>
      {state ? (
        <p className={state.kind === "err" ? "cp-warn-text" : "cp-card-sub"} role={state.kind === "err" ? "alert" : "status"}>
          {state.text}
        </p>
      ) : null}
    </div>
  );
}

const OFFER_STATUS = {
  verified: { tone: "good", label: "Verified", d: "M5 12l5 5 9-10" },
  waiting: { tone: "warn", label: "Waiting for you", d: "M12 7v5l3 3" },
  rejected: { tone: "risk", label: "Not accepted", d: "M6 6l12 12M18 6L6 18" },
} as const;

/**
 * Offers students chose to share. A page view names nobody; "Show names" is the explicit, logged call (each student returned
 * sees it in their own access log). A package the student did not give is blank, never 0.0 LPA.
 */
export function OutcomesTable({ offers, sample }: { offers: OfferRow[]; sample: boolean }) {
  const [names, setNames] = useState<Record<string, string | null> | null>(null);
  const [status, setStatus] = useState<Record<string, OfferRow["status"]>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reveal() {
    if (sample) return setMsg("Sample: no names were fetched.");
    setBusy(true);
    setMsg(null);
    const r = await callJson<{ outcomes: { id: string; studentName: string | null }[] }>("/api/v1/tpo/outcomes/reveal", { method: "POST", json: {} });
    setBusy(false);
    if (!r.ok || !r.data) return setMsg(messageFor(r.error));
    setNames(Object.fromEntries(r.data.outcomes.map((o) => [o.id, o.studentName])));
  }

  async function verify(id: string) {
    if (sample) return setMsg("Sample: nothing was verified.");
    setBusy(true);
    setMsg(null);
    const r = await callJson<{ id: string }>(`/api/v1/tpo/outcomes/${id}/verify`, { method: "POST" });
    setBusy(false);
    if (!r.ok) return setMsg(messageFor(r.error));
    setStatus((s) => ({ ...s, [id]: "verified" }));
  }

  async function letter(id: string) {
    if (sample) return setMsg("Sample: there is no letter to open.");
    setBusy(true);
    const r = await callBlob(`/api/v1/tpo/outcomes/${id}/letter`, { method: "POST", idempotent: false });
    setBusy(false);
    if (!r.ok || !r.data) return setMsg(messageFor(r.error));
    const url = URL.createObjectURL(r.data);
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  return (
    <>
      <div className="cp-actions">
        <button className="cp-btn" data-variant="outline" type="button" disabled={busy || names !== null} onClick={() => void reveal()}>
          Show names
        </button>
        <span className="cp-card-sub">Names stay hidden until you ask. Each student you open can see that in their own account.</span>
      </div>
      {msg ? (
        <p className="cp-warn-text" role="alert">
          {msg}
        </p>
      ) : null}
      <div className="cp-scroll">
        <table className="cp-table">
          <thead>
            <tr>
              <th scope="col">Student</th>
              <th scope="col">Programme</th>
              <th scope="col">Employer</th>
              <th scope="col" className="cp-num">
                Package
              </th>
              <th scope="col">Letter</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {offers.map((o) => {
              const st = OFFER_STATUS[status[o.id] ?? o.status];
              const shown = status[o.id] ?? o.status;
              const named = names ? names[o.id] : undefined;
              return (
                <tr key={o.id}>
                  <td>{names ? <b>{named ?? "A student who chose not to share a name"}</b> : <span className="cp-muted">Name hidden</span>}</td>
                  <td>{o.programme}</td>
                  <td>{o.employer}</td>
                  <td className="cp-num">{o.lpa > 0 ? `${o.lpa.toFixed(1)} LPA` : <span className="cp-muted">Not given</span>}</td>
                  <td>
                    {o.letter ? (
                      <button className="cp-link" type="button" disabled={busy} onClick={() => void letter(o.id)}>
                        View letter
                      </button>
                    ) : (
                      <span className="cp-muted">Not uploaded</span>
                    )}
                  </td>
                  <td>
                    <span className="cp-status" data-tone={st.tone}>
                      <Icon d={st.d} />
                      {st.label}
                    </span>
                    {shown === "waiting" ? (
                      <button className="cp-btn" data-variant="outline" type="button" disabled={busy} onClick={() => void verify(o.id)}>
                        Mark verified
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

interface Preview {
  rowsTotal: number;
  validEmails: number;
  invalidEmails: number;
  duplicates: number;
  uniqueEmails: number;
  canStage: boolean;
  columns: { email: string; placed: string | null };
}

/** Roster import: a preview first (counts only, no address is echoed), then the import. A list under 10 different addresses is not accepted. */
export function RosterImport({ cohorts }: { cohorts: { id: string; label: string }[] }) {
  const router = useRouter();
  const [cohortId, setCohortId] = useState(cohorts[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function pick(f: File | null) {
    setFile(f);
    setPreview(null);
    setMsg(null);
    if (!f || !cohortId) return;
    setBusy(true);
    const r = await callJson<Preview>(`/api/v1/tpo/cohorts/${cohortId}/roster/preview`, { method: "POST", raw: { body: f, type: "text/csv" } });
    setBusy(false);
    if (!r.ok || !r.data) return setMsg({ kind: "err", text: messageFor(r.error) });
    setPreview(r.data);
  }

  async function run() {
    if (!file) return;
    setBusy(true);
    const r = await callJson<{ rowsValid: number; rowsRejected: number }>(`/api/v1/tpo/cohorts/${cohortId}/roster`, { method: "POST", raw: { body: file, type: "text/csv" } });
    setBusy(false);
    if (!r.ok || !r.data) return setMsg({ kind: "err", text: messageFor(r.error) });
    setMsg({ kind: "ok", text: `Imported ${r.data.rowsValid} students${r.data.rowsRejected ? `; ${r.data.rowsRejected} rows were not usable` : ""}. Only email hashes and the placed flag are kept.` });
    setPreview(null);
    router.refresh();
  }

  if (cohorts.length === 0) return null;
  return (
    <section className="cp-card" aria-labelledby="import-h">
      <h2 id="import-h">Import your student list</h2>
      <p className="cp-card-sub">A CSV with an email column and, if you have it, a placed column. We keep only a hash of each email and the placed flag, never the address or a name.</p>
      <div className="cp-fields">
        <div className="cp-field">
          <label htmlFor="ri-cohort">Cohort</label>
          <select id="ri-cohort" value={cohortId} onChange={(e) => setCohortId(e.target.value)}>
            {cohorts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div className="cp-field">
          <label htmlFor="ri-file">Roster CSV</label>
          <input id="ri-file" type="file" accept=".csv,text/csv" onChange={(e) => void pick(e.target.files?.[0] ?? null)} />
        </div>
      </div>
      {msg ? (
        <p className={msg.kind === "err" ? "cp-warn-text" : "cp-card-sub"} role={msg.kind === "err" ? "alert" : "status"}>
          {msg.text}
        </p>
      ) : null}
      {preview ? (
        <div aria-live="polite">
          <p className="cp-card-sub">
            {preview.rowsTotal} rows, {preview.uniqueEmails} different email addresses ({preview.invalidEmails} not usable, {preview.duplicates} repeated). Using the column &quot;
            {preview.columns.email}&quot;
            {preview.columns.placed ? ` and "${preview.columns.placed}" for placed.` : "; no placed column."}
          </p>
          {preview.canStage ? (
            <button className="cp-btn" type="button" disabled={busy} onClick={() => void run()}>
              Import this list
            </button>
          ) : (
            <p className="cp-warn-text">A list needs at least 10 different email addresses, so no student can be picked out from the totals. Add more students and try again.</p>
          )}
        </div>
      ) : null}
    </section>
  );
}
