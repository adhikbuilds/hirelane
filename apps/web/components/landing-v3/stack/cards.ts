/** Card models for the landing card stack. Pure: the same job always yields the same card. */
import { agoShort, hashString, matchFixture, type FixtureMatch } from "../../landing/demo-model";
import type { DemoJob } from "../../landing/types";

export type NeedsField = { id: string; label: string; answers: string[] };

export type StackExtra = { freshAt: string | null; openRoles: number | null; postingUrl: string | null };

export type PayTrace = { stated: string; normalised: string; converted: boolean };

export type StackCardModel = {
  slug: string;
  company: string;
  logoPath: string | null;
  title: string;
  where: string;
  payAnnual: string;
  payStated: string | null;
  posted: string | null;
  match: FixtureMatch;
  needs: NeedsField | null;
  openRoles: number | null;
  postingUrl: string | null;
  payTrace: PayTrace | null;
};

const NEEDS: NeedsField[] = [
  { id: "notice", label: "Notice period", answers: ["Immediately", "30 days", "60 days"] },
  { id: "auth", label: "Work authorisation", answers: ["I am authorised", "Need sponsorship"] },
  { id: "start", label: "Earliest start", answers: ["This month", "Next month", "In 3 months"] },
];

/** About one card in five has nothing to ask, so the stack shows both a gated and an open approve. */
export function needsFor(slug: string): NeedsField | null {
  const h = hashString(`needs:${slug}`);
  return h % 5 === 0 ? null : NEEDS[h % NEEDS.length]!;
}

/** Only http(s) links ever reach an anchor. */
export function safeHttpUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export function buildStackCards(demo: readonly DemoJob[], extras: Readonly<Record<string, StackExtra>>, now: Date): StackCardModel[] {
  return demo.map((j) => {
    const x = extras[j.slug];
    const match = matchFixture(j.slug, j.skills, j.payMaxUsdMinor);
    const stated = j.payStated;
    return {
      slug: j.slug,
      company: j.company,
      logoPath: j.logoPath,
      title: j.title,
      where: j.where,
      payAnnual: j.payAnnual,
      payStated: stated,
      posted: x?.freshAt ? agoShort(x.freshAt, now) : null,
      match,
      needs: needsFor(j.slug),
      openRoles: x?.openRoles ?? null,
      postingUrl: safeHttpUrl(x?.postingUrl),
      payTrace: j.payAnnual === "Not stated" ? null : { stated: stated ?? j.payAnnual, normalised: j.payAnnual, converted: stated !== null },
    };
  });
}
