import Link from "next/link";
import type { MessageView, ReceiptView, TrackerRow, TrackerView as View } from "@/lib/student/types";
import { CopyIcon } from "./CopyButton";
import { OutcomeButtons } from "./OutcomeButtons";

interface Selected {
  id: string;
  company: string;
  role: string;
  receipt: ReceiptView | null;
  fallbackUrl: string | null;
}

const mailto = (subject: string) => `mailto:?subject=${encodeURIComponent(subject)}`;

function Row({ r, selected, tab }: { r: TrackerRow; selected: boolean; tab: "applications" | "inbox" }) {
  const right = r.pill ? <span className={`st-pill ${r.pill === "Interview" ? "st-intv" : r.pill === "Offer" ? "st-offer" : "st-appl"}`}>{r.pill}</span> : r.right ? <span className="st-small st-num">{r.right}</span> : <span />;
  const inner = (
    <>
      <span className="st-t">{r.company}</span>
      {r.finish ? (
        <Link className="st-btn st-sm" style={{ ["--h" as string]: "32px" }} href={`/tracker/${r.id}`}>
          Finish on their site
        </Link>
      ) : (
        right
      )}
      <span className="st-m">{r.meta}</span>
      {r.followUp ? (
        <a className="st-fu" href={mailto(`Following up: ${r.role}`)}>
          Draft a follow-up
        </a>
      ) : null}
    </>
  );
  if (r.pill === "Offer" || r.finish) return <div className={`st-trow${selected ? " st-sel" : ""}`}>{inner}</div>;
  if (r.followUp)
    return (
      <div className={`st-trow${selected ? " st-sel" : ""}`}>
        <Link className="st-t" style={{ color: "inherit", textDecoration: "none" }} href={`/tracker?a=${r.id}${tab === "inbox" ? "&v=inbox" : ""}`} scroll={false}>
          {r.company}
        </Link>
        {right}
        <span className="st-m">{r.meta}</span>
        <a className="st-fu" href={mailto(`Following up: ${r.role}`)}>
          Draft a follow-up
        </a>
      </div>
    );
  return (
    <Link className={`st-trow${selected ? " st-sel" : ""}`} href={`/tracker?a=${r.id}${tab === "inbox" ? "&v=inbox" : ""}`} aria-current={selected ? "true" : undefined} scroll={false}>
      {inner}
    </Link>
  );
}

/** Applications by stage, the reply in the middle, the receipt on the right. Every stage says what comes next, none is a dead end. */
export function TrackerPanes({ view, selected, message, tab, sample, detail = false }: { view: View; selected: Selected | null; message: MessageView | null; tab: "applications" | "inbox"; sample: boolean; detail?: boolean }) {
  const unmatched = view.unmatched;
  return (
    <>
      <div className="st-a-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 className="st-a-title">Tracker</h1>
          {sample ? <p className="st-sample">Sample student</p> : null}
        </div>
        <div className="st-seg" role="group" aria-label="Tracker view">
          <Link href="/tracker" aria-current={tab === "applications" ? "true" : undefined}>
            Applications
          </Link>
          <Link href="/tracker?v=inbox" aria-current={tab === "inbox" ? "true" : undefined}>
            Inbox{view.messages.length > 0 ? <span className="st-num">&nbsp;{view.messages.length}</span> : null}
          </Link>
        </div>
      </div>
      {detail ? (
        <Link className="st-t-back st-tlink" href={tab === "inbox" ? "/tracker?v=inbox" : "/tracker"} scroll={false}>
          Back to the list
        </Link>
      ) : null}
      <div className="st-tracker" data-detail={detail ? "true" : undefined}>
        <div className="st-t-list">
          {tab === "inbox" ? (
            <>
              <div className="st-grp">
                <span>Messages</span>
                <span className="st-num">{view.messages.length}</span>
              </div>
              {view.messages.length === 0 ? <div className="st-trow st-static" style={{ color: "var(--ink-2)" }}><span className="st-m" style={{ gridColumn: 1 }}>Replies from employers show here, matched to the application they answer.</span></div> : null}
              {view.messages.map((m) => (
                <Link key={m.id} className={`st-trow${message?.id === m.id ? " st-sel" : ""}`} href={`/tracker?v=inbox&m=${m.id}`} scroll={false}>
                  <span className="st-t">{m.from}</span>
                  <span className="st-small st-num">{m.at}</span>
                  <span className="st-m">{m.subject || m.excerpt.slice(0, 80)}</span>
                </Link>
              ))}
            </>
          ) : (
            <>
              {view.groups.map((g) => (
                <div key={g.id}>
                  <div className="st-grp">
                    <span>{g.label}</span>
                    <span className="st-num">{g.rows.length}</span>
                  </div>
                  {g.rows.length === 0 && g.empty ? (
                    <div className="st-trow st-static" style={{ color: "var(--ink-2)" }}>
                      <span className="st-m" style={{ gridColumn: 1 }}>
                        {g.empty}
                      </span>
                    </div>
                  ) : null}
                  {g.rows.map((r) => (
                    <Row key={r.id} r={r} selected={selected?.id === r.id} tab={tab} />
                  ))}
                </div>
              ))}
              {unmatched.length > 0 ? (
                <div>
                  <div className="st-grp">
                    <span>Not matched to an application</span>
                    <span className="st-num">{unmatched.length}</span>
                  </div>
                  {unmatched.map((m) => (
                    <Link key={m.id} className="st-trow" href={`/tracker?v=inbox&m=${m.id}`}>
                      <span className="st-t st-mono" style={{ fontSize: 13 }}>
                        {m.from}
                      </span>
                      <span className="st-small">{m.at}</span>
                      <span className="st-m">{m.subject}</span>
                    </Link>
                  ))}
                </div>
              ) : null}
            </>
          )}
        </div>

        <div className="st-t-msg">
          {message ? (
            <>
              <h2>
                {message.from}
                {selected ? `, ${selected.role}` : ""}
              </h2>
              <div className="st-msg-meta">
                <span>
                  From {message.fromAddr ? <span className="st-mono">{message.fromAddr}</span> : message.from}, {message.at}
                </span>
                {message.toAddr ? (
                  <span>
                    To <span className="st-mono">{message.toAddr}</span>
                  </span>
                ) : null}
                <span className="st-sender">
                  <span aria-hidden="true">{message.matchedBy === "domain" ? "✓" : "~"}</span>{" "}
                  {message.matchedBy === "domain" ? `Sender matches ${message.from}` : message.matchedBy === "company" ? "Matched by company name only. Check the sender before you reply." : "Not matched to any application of yours"}
                </span>
              </div>
              <div className="st-msg-body">{message.excerpt ? message.excerpt.split(/\n{2,}/).map((p, i) => <p key={i}>{p}</p>) : <p>{message.subject}</p>}</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <a className="st-btn st-p" style={{ ["--h" as string]: "44px" }} href={mailto(`Re: ${message.subject || selected?.role || "your message"}`)}>
                  Draft a reply
                </a>
              </div>
              {selected ? <OutcomeButtons employer={selected.company} role={selected.role} sample={sample} inline /> : null}
              <p className="st-small">Replies open in your own email app. They’ll see your personal email.</p>
            </>
          ) : selected ? (
            <>
              <h2>
                {selected.company}, {selected.role}
              </h2>
              <p className="st-ink2">{selected.receipt ? "No reply yet. When they write back, it shows here, matched to this application." : "This one hasn’t been sent yet. A receipt shows here once it is."}</p>
              {selected.fallbackUrl ? (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <Link className="st-btn st-p" style={{ ["--h" as string]: "44px" }} href={`/tracker/${selected.id}`}>
                    Finish on their site
                  </Link>
                </div>
              ) : null}
            </>
          ) : (
            <>
              <h2>Nothing here yet</h2>
              <p className="st-ink2">Swipe right on a pick and the application shows here, with its receipt and any reply.</p>
              <div>
                <Link className="st-btn st-p" style={{ ["--h" as string]: "44px" }} href="/picks">
                  See today’s picks
                </Link>
              </div>
            </>
          )}
        </div>

        <div className="st-t-rec">
          <h3>Receipt</h3>
          {selected?.receipt ? (
            <>
              <dl>
                <div>
                  <dt>Applied</dt>
                  <dd>{selected.receipt.applied}</dd>
                </div>
                {selected.receipt.where ? (
                  <div>
                    <dt>Where</dt>
                    <dd>{selected.receipt.where}</dd>
                  </div>
                ) : null}
                {selected.receipt.from ? (
                  <div>
                    <dt>From</dt>
                    <dd className="st-addr">
                      <span className="st-mono" title={selected.receipt.from}>
                        {selected.receipt.from}
                      </span>
                      <CopyIcon text={selected.receipt.from} aria="Copy address" />
                    </dd>
                  </div>
                ) : null}
                {selected.receipt.resume ? (
                  <div>
                    <dt>Resume</dt>
                    <dd>{selected.receipt.resume}</dd>
                  </div>
                ) : null}
                <div>
                  <dt>Answers</dt>
                  <dd>{selected.receipt.answers}</dd>
                </div>
                <div>
                  <dt>Result</dt>
                  <dd>{selected.receipt.result}</dd>
                </div>
              </dl>
              <OutcomeButtons employer={selected.company} role={selected.role} sample={sample} />
            </>
          ) : (
            <p className="st-small">{selected ? "The receipt shows here once this application is sent." : "Pick an application to see its receipt."}</p>
          )}
        </div>
      </div>
    </>
  );
}
