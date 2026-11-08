"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ConsoleDrive, DriveInboxData } from "@/lib/adapters/campus-drives";
import { callJson, messageFor } from "@/lib/campus-client";

interface Parsed {
  rules: string[];
  scam: { risk: string; flags: { id: string; severity: string; quote: string }[] };
  suggestedDeadline: string | null;
}

type Stage = { name: "form" } | { name: "parsed"; parse: Parsed } | { name: "drafted"; id: string } | { name: "live" };

const STATUS_LABEL: Record<ConsoleDrive["status"], string> = { draft: "Draft", live: "Live", closed: "Closed" };

/**
 * Drive inbox: paste a notice, check what was read from it, save a draft, announce it. Every step calls the TPO drive routes
 * (rules only, 0 LLM calls; the link is never opened). Nothing is saved before the notice has been checked.
 */
export function DriveConsole({ data }: { data: DriveInboxData }) {
  const router = useRouter();
  const [cohortId, setCohortId] = useState(data.cohorts[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [link, setLink] = useState("");
  const [notice, setNotice] = useState("");
  const [deadline, setDeadline] = useState("");
  const [rounds, setRounds] = useState("");
  const [documents, setDocuments] = useState("");
  const [stage, setStage] = useState<Stage>({ name: "form" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const base = () => ({ cohortId, title: title.trim(), noticeText: notice.trim(), ...(link.trim() ? { link: link.trim() } : {}) });

  async function check() {
    setBusy(true);
    setError(null);
    const r = await callJson<Parsed>("/api/v1/tpo/drives/preview", { method: "POST", json: base() });
    setBusy(false);
    if (!r.ok || !r.data) return setError(messageFor(r.error));
    setDeadline(r.data.suggestedDeadline ?? "");
    setStage({ name: "parsed", parse: r.data });
  }

  async function save() {
    setBusy(true);
    setError(null);
    const body = { ...base(), ...(deadline ? { deadline } : {}), ...(rounds.trim() ? { rounds: rounds.trim() } : {}), ...(documents.trim() ? { documents: documents.trim() } : {}) };
    const r = await callJson<{ id: string }>("/api/v1/tpo/drives/draft", { method: "POST", json: body });
    setBusy(false);
    if (!r.ok || !r.data) return setError(messageFor(r.error));
    setStage({ name: "drafted", id: r.data.id });
    router.refresh();
  }

  async function announce(id: string, fromForm: boolean) {
    setBusy(true);
    setError(null);
    const r = await callJson<{ id: string }>(`/api/v1/tpo/drives/${id}/announce`, { method: "POST" });
    setBusy(false);
    if (!r.ok) return setError(messageFor(r.error));
    if (fromForm) setStage({ name: "live" });
    router.refresh();
  }

  async function close(id: string) {
    setBusy(true);
    setError(null);
    const r = await callJson<{ id: string }>(`/api/v1/tpo/drives/${id}/close`, { method: "POST" });
    setBusy(false);
    if (!r.ok) return setError(messageFor(r.error));
    router.refresh();
  }

  const reset = () => {
    setTitle("");
    setLink("");
    setNotice("");
    setDeadline("");
    setRounds("");
    setDocuments("");
    setStage({ name: "form" });
  };

  return (
    <>
      <header className="cp-top">
        <div>
          <h1 className="cp-title">Drives</h1>
          <p className="cp-sub">
            Paste the notice. We read the rules from it (no AI is used, and the link is never opened). You check them, save a draft, then announce it to the students who qualify. {data.counts.draft}{" "}
            draft, {data.counts.live} open, {data.counts.closed} closed.
          </p>
        </div>
      </header>

      {error ? (
        <p className="cp-warn-text" role="alert">
          {error}
        </p>
      ) : null}

      <section className="cp-card" aria-labelledby="add-h">
        <h2 id="add-h">Add a drive</h2>
        {data.cohorts.length === 0 ? (
          <p className="cp-card-sub">Add a cohort before publishing a drive: a drive goes to the students of one cohort.</p>
        ) : stage.name === "live" ? (
          <>
            <p className="cp-card-sub" role="status">
              The drive is live. Students who qualify, and those we could not check, now see it.
            </p>
            <button className="cp-btn" type="button" onClick={reset}>
              Add another drive
            </button>
          </>
        ) : (
          <form
            className="cp-drive-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (stage.name === "form" && !busy) void check();
            }}
          >
            <div className="cp-fields">
              <div className="cp-field">
                <label htmlFor="dc-cohort">Cohort</label>
                <select id="dc-cohort" value={cohortId} onChange={(e) => setCohortId(e.target.value)} disabled={stage.name !== "form"}>
                  {data.cohorts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="cp-field">
                <label htmlFor="dc-title">Drive title</label>
                <input id="dc-title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} disabled={stage.name !== "form"} />
              </div>
              <div className="cp-field" data-wide>
                <label htmlFor="dc-link">Apply link (optional)</label>
                <input id="dc-link" value={link} onChange={(e) => setLink(e.target.value)} disabled={stage.name !== "form"} inputMode="url" />
                <span className="cp-hint">Students apply here. We never open it ourselves.</span>
              </div>
            </div>
            <label htmlFor="dc-notice">Notice text</label>
            <textarea
              id="dc-notice"
              className="cp-textarea"
              rows={7}
              value={notice}
              onChange={(e) => setNotice(e.target.value)}
              disabled={stage.name !== "form"}
              placeholder="Paste the notice or email you received"
            />
            {stage.name === "form" ? (
              <div className="cp-actions">
                <button className="cp-btn" type="submit" disabled={busy || !title.trim() || !notice.trim() || !cohortId}>
                  Check the notice
                </button>
              </div>
            ) : null}
          </form>
        )}

        {stage.name === "parsed" ? (
          <div aria-live="polite">
            <h3>What we read from the notice</h3>
            {stage.parse.rules.length > 0 ? (
              <ul className="cp-rules">
                {stage.parse.rules.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            ) : (
              <p className="cp-card-sub">No rules were found. Students would see the drive with nothing to check against.</p>
            )}
            {stage.parse.scam.flags.length > 0 ? (
              <p className="cp-warn-text">
                Warning signs ({stage.parse.scam.risk}): {stage.parse.scam.flags.map((f) => `"${f.quote}"`).join(", ")}. Check this notice before you publish it.
              </p>
            ) : (
              <p className="cp-safe">No warning signs found: no fee, no Telegram-only contact.</p>
            )}
            <div className="cp-fields">
              <div className="cp-field">
                <label htmlFor="dc-deadline">Last date to apply</label>
                <input id="dc-deadline" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
                <span className="cp-hint">{stage.parse.suggestedDeadline ? "Read from the notice. Change it if it is wrong." : "Not found in the notice. Optional."}</span>
              </div>
              <div className="cp-field">
                <label htmlFor="dc-rounds">Selection rounds</label>
                <input id="dc-rounds" value={rounds} onChange={(e) => setRounds(e.target.value)} placeholder="Aptitude test, then two interviews" />
              </div>
              <div className="cp-field" data-wide>
                <label htmlFor="dc-docs">Documents to carry</label>
                <input id="dc-docs" value={documents} onChange={(e) => setDocuments(e.target.value)} placeholder="Resume, college ID, marksheets" />
              </div>
            </div>
            <div className="cp-actions">
              <button className="cp-btn" type="button" disabled={busy} onClick={() => void save()}>
                Save as draft
              </button>
              <button className="cp-btn" data-variant="outline" type="button" disabled={busy} onClick={() => setStage({ name: "form" })}>
                Edit the notice
              </button>
            </div>
          </div>
        ) : null}

        {stage.name === "drafted" ? (
          <div aria-live="polite">
            <p className="cp-card-sub" role="status">
              Saved as a draft. Students cannot see it yet. The count of who qualifies appears after the next nightly update; you can announce it now or wait for it.
            </p>
            <div className="cp-actions">
              <button className="cp-btn" type="button" disabled={busy} onClick={() => void announce(stage.id, true)}>
                Announce to students
              </button>
              <button className="cp-btn" data-variant="outline" type="button" onClick={reset}>
                Add another drive
              </button>
            </div>
          </div>
        ) : null}
      </section>

      <section className="cp-card" aria-labelledby="list-h">
        <h2 id="list-h">Your drives</h2>
        {data.drives.length === 0 ? (
          <p className="cp-card-sub">No drive yet. Paste your first notice above.</p>
        ) : (
          <ul className="cp-drive-list">
            {data.drives.map((d) => (
              <li key={d.id} className="cp-drive-item">
                <div>
                  <b>{d.title}</b> <span className="cp-status">{STATUS_LABEL[d.status]}</span>
                  <p className="cp-card-sub">
                    {d.cohort}
                    {d.host ? `, ${d.host}` : ""}
                    {d.deadlineLabel ? `. Closes ${d.deadlineLabel}${d.daysLeft !== null ? ` (${d.daysLeft} days)` : ""}` : ""}
                  </p>
                  {d.rules.length > 0 ? <p className="cp-card-sub">Rules: {d.rules.join("; ")}</p> : null}
                  {d.scam.flags.length > 0 ? (
                    <p className="cp-warn-text">
                      Warning signs ({d.scam.risk}): {d.scam.flags.map((f) => `"${f.quote}"`).join(", ")}
                    </p>
                  ) : null}
                  <p className="cp-card-sub">{d.reach.label}</p>
                  {d.next ? <p className="cp-card-sub">{d.next}</p> : null}
                </div>
                <div className="cp-actions">
                  {d.status === "draft" ? (
                    <button className="cp-btn" type="button" disabled={busy} onClick={() => void announce(d.id, false)}>
                      Announce to students
                    </button>
                  ) : null}
                  {d.status !== "closed" ? (
                    <button className="cp-btn" data-variant="outline" type="button" disabled={busy} onClick={() => void close(d.id)}>
                      Close this drive
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
