import Link from "next/link";
import type { CardData, RuleStatus } from "@/lib/student/types";
import { Ic } from "./Icon";

export const GLYPH: Record<RuleStatus, { mark: string; cls: string }> = {
  pass: { mark: "✓", cls: "st-g-ok" },
  unknown: { mark: "~", cls: "st-g-un" },
  fail: { mark: "✕", cls: "st-g-no" },
};

/**
 * The one coloured surface in the app (DESIGN.md 4.4). Fields in order: company, role, pay exactly as stated, the fit line,
 * freshness; everything else is behind "Details". Presentational: the feed owns the buttons and which card is open.
 */
export function RoleCard({
  card,
  open,
  onToggle,
}: {
  card: CardData;
  open: boolean;
  onToggle: () => void;
}) {
  const allPass = card.rules.length > 0 && card.rules.every((r) => r.status === "pass");
  return (
    <article className={`st-rc st-${card.tone}${open ? " st-open" : ""}`} aria-label={`${card.role} at ${card.company}`}>
      <div className="st-rc-co">
        <span className="st-rc-logo" aria-hidden="true">
          {card.initial}
        </span>
        <div>
          <span className="st-rc-name">{card.company}</span>
          {card.city ? <span>{card.city}</span> : null}
        </div>
      </div>
      <h3 className="st-rc-role">{card.role}</h3>
      {card.pay.stated ? (
        <div className="st-rc-pay">
          <b>{card.pay.headline}</b>
          {card.pay.monthly ? <span>{card.pay.monthly}</span> : null}
        </div>
      ) : (
        <div className="st-rc-pay st-none">
          <b>Pay not stated</b>
          <span>The posting doesn’t give pay. We never estimate it.</span>
        </div>
      )}
      <p className="st-rc-fitline">
        <span className="st-glyph" aria-hidden="true">
          {allPass ? "✓" : "~"}
        </span>
        {card.verdict}
      </p>
      <p className="st-rc-fresh">{card.fresh}</p>
      <button className="st-rc-more" type="button" aria-expanded={open} onClick={onToggle}>
        Details
        <Ic name="chev" small />
      </button>
      <div className="st-rc-detail">
        {card.about ? <p className="st-rc-what">{card.about}</p> : null}
        {card.chips.length > 0 ? (
          <ul className="st-rc-chips">
            {card.chips.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        ) : null}
        {card.rules.length > 0 ? (
          <div className="st-rc-maths">
            {card.rules.map((r) => (
              <div key={r.text}>
                <span className="st-glyph">{GLYPH[r.status].mark}</span>
                <span>
                  {r.text}
                  {r.note ? (
                    <>
                      <br />
                      <span style={{ opacity: 0.75 }}>{r.note}</span>
                    </>
                  ) : null}
                </span>
              </div>
            ))}
          </div>
        ) : null}
        {card.mustHaves ? (
          <div className="st-rc-must">
            <span className="st-num">
              {card.mustHaves.met} of {card.mustHaves.total} must-haves
            </span>
            <i style={{ "--v": card.mustHaves.met / card.mustHaves.total } as React.CSSProperties} />
          </div>
        ) : null}
        {card.who ? (
          <Link className="st-rc-who" href="/network">
            <span className="st-av" aria-hidden="true">
              {card.who.initials}
            </span>
            <span>
              {card.who.text}
              <u>Draft an ask</u>
            </span>
          </Link>
        ) : null}
        {card.href ? (
          <a className="st-rc-link" href={card.href}>
            The day, the rounds and the full posting
          </a>
        ) : null}
      </div>
    </article>
  );
}
