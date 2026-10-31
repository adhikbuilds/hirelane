import Link from "next/link";
import type { ClosedDriveView, DriveView, DrivesData } from "@/lib/student/types";
import { GLYPH } from "./RoleCard";
import { Ic } from "./Icon";

const name = (d: { role: string; company: string | null }) => d.role;

function Row({ d, selected }: { d: DriveView; selected: boolean }) {
  const g = GLYPH[d.state === "eligible" ? "pass" : "unknown"];
  // The row names the first rule we could not check, never one the student passed.
  const unchecked = d.state === "check" ? d.rules.find((r) => r.status === "unknown") : undefined;
  return (
    <Link className={`st-drv-row${selected ? " st-sel" : ""}`} href={`/drives?d=${d.id}`} aria-current={selected ? "true" : undefined} scroll={false}>
      <span className="st-t">{name(d)}</span>
      <span className="st-dl">{d.closes}</span>
      <span className="st-co">{d.company ?? "From your placement cell"}</span>
      <span className="st-vd">
        <span className={`st-glyph ${g.cls}`} style={{ height: 18 }}>
          {g.mark}
        </span>
        {unchecked ? (
          <span>
            {unchecked.text} {/semester/i.test(unchecked.text) ? <u>Add semester marks</u> : null}
          </span>
        ) : (
          <span>{d.verdict}</span>
        )}
      </span>
    </Link>
  );
}

function Closed({ d }: { d: ClosedDriveView }) {
  return (
    <div className="st-drv-row" style={{ borderTop: "1px solid var(--line)", cursor: "default" }}>
      <span className="st-t">{d.role}</span>
      <span className="st-dl">{d.closes}</span>
      {d.company ? <span className="st-co">{d.company}</span> : null}
      {d.note ? (
        <span className="st-vd">
          <span className="st-glyph st-g-no" style={{ height: 18 }}>
            ✕
          </span>
          <span>{d.note}</span>
        </span>
      ) : null}
    </div>
  );
}

/** Drives from the student's placement cell, with the engine's own verdict on each. Pick one to see the maths. */
export function DrivesView({ drives, selectedId, college }: { drives: DrivesData; selectedId: string | null; college: string | null }) {
  const all = [...drives.open, ...drives.check];
  const selected = all.find((d) => d.id === selectedId) ?? all[0] ?? null;
  return (
    <>
      <div className="st-a-head">
        <h1 className="st-a-title">Drives from your college</h1>
        {college ? <p className="st-a-count">{college}</p> : null}
      </div>
      {all.length === 0 && drives.closed.length === 0 ? (
        <div className="st-panel" style={{ padding: 24, display: "grid", gap: 8, maxWidth: 560 }}>
          <div className="st-c-h">No drives yet.</div>
          <p className="st-ink2">{college ? "When your placement cell publishes a drive, it shows here with a check against your marks." : "Join your college and its drives show up here, next to your picks."}</p>
          <p>
            <Link className="st-tlink" href={college ? "/picks" : "/welcome/college"}>
              {college ? "See today’s picks" : "Join your college"}
              <Ic name="arrow" small />
            </Link>
          </p>
        </div>
      ) : (
        <div className="st-drv">
          <div style={{ display: "grid", gap: 20 }}>
            {drives.open.length > 0 ? (
              <div>
                <div className="st-sec-h">
                  <h2>Open, by deadline</h2>
                </div>
                <div className="st-panel st-rows">
                  {drives.open.map((d) => (
                    <Row key={d.id} d={d} selected={selected?.id === d.id} />
                  ))}
                </div>
              </div>
            ) : null}
            {drives.check.length > 0 ? (
              <div>
                <div className="st-sec-h">
                  <h2>We couldn’t check</h2>
                </div>
                <div className="st-panel st-rows">
                  {drives.check.map((d) => (
                    <Row key={d.id} d={d} selected={selected?.id === d.id} />
                  ))}
                </div>
              </div>
            ) : null}
            {drives.closed.length > 0 ? (
              <div className="st-panel">
                <details className="st-hidden-d" open>
                  <summary>
                    Closed ({drives.closed.length})
                    <Ic name="chev" small />
                  </summary>
                  {drives.closed.map((d) => (
                    <Closed key={d.id} d={d} />
                  ))}
                </details>
              </div>
            ) : null}
          </div>
          {selected ? <Detail d={selected} /> : null}
        </div>
      )}
    </>
  );
}

function Detail({ d }: { d: DriveView }) {
  return (
    <div className="st-panel st-detail">
      <div>
        <div className="st-small">From your placement cell, published {d.publishedLabel}</div>
        <h2 style={{ marginTop: 6 }}>{d.role}</h2>
        {d.about || d.company ? <div className="st-ink2">{d.about ?? d.company}</div> : null}
      </div>
      {d.chips.length > 0 ? (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {d.chips.map((c) => (
            <span className="st-chip" key={c}>
              {c}
            </span>
          ))}
        </div>
      ) : null}
      {d.lastDate || d.pay ? (
        <dl className="st-kv">
          {d.pay ? (
            <>
              <dt>Pay</dt>
              <dd>{d.pay}</dd>
            </>
          ) : null}
          {d.lastDate ? (
            <>
              <dt>Last date</dt>
              <dd>{d.lastDate}</dd>
            </>
          ) : null}
        </dl>
      ) : (
        <p className="st-small">The notice names no closing date, so check it.</p>
      )}
      <div className="st-vlist">
        <div className="st-c-h" style={{ marginBottom: 6 }}>
          Your check
        </div>
        {d.rules.length === 0 ? (
          <div className="st-vrow">
            <span>{d.verdict}</span>
          </div>
        ) : (
          d.rules.map((r) => (
            <div className="st-vrow" key={r.text}>
              <span className={`st-glyph ${GLYPH[r.status].cls}`}>{GLYPH[r.status].mark}</span>
              <span>
                {r.text}
                {r.note ? <small>{r.note}</small> : null}
              </span>
            </div>
          ))
        )}
      </div>
      {d.rounds || d.documents ? (
        <div className="st-vlist">
          <div className="st-c-h" style={{ marginBottom: 6 }}>
            Rounds and what to carry
          </div>
          {d.rounds
            ? d.rounds
                .split("\n")
                .filter((l) => l.trim())
                .map((l, n) => (
                  <div className="st-vrow" key={n}>
                    <span className="st-glyph st-g-un">{n + 1}</span>
                    <span>{l}</span>
                  </div>
                ))
            : null}
          {d.documents ? (
            <div className="st-vrow">
              <span>
                Carry: {d.documents}
              </span>
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="st-vlist">
        <div className="st-c-h" style={{ marginBottom: 6 }}>
          How you’ll apply
        </div>
        <div className="st-vrow" style={{ display: "block" }}>
          {d.link ? "Their form isn’t one we can fill, so you apply there. Your answers are ready to copy." : "Your placement cell’s notice says how to apply. Your answers are ready to copy."}
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {d.link ? (
          <a className="st-btn st-p" href={d.link} target="_blank" rel="noopener noreferrer">
            Apply on their form
          </a>
        ) : (
          <Link className="st-btn st-p" href="/picks">
            See today’s picks
          </Link>
        )}
      </div>
    </div>
  );
}
