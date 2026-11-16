/**
 * Capability-claim registry behind the copy guard (tests/claims.test.ts).
 *
 * Every present-tense claim about the core loop (approve, fill, hand off, track replies, encrypted storage) is tied
 * to a feature flag below. A claim may appear in user-facing copy in present tense only once its flag is true.
 * Flip a flag in the same change that ships the feature, never before.
 */

export type Feature = "approvalQueue" | "autoFill" | "handOff" | "replyTracking" | "encryptedStorage";
export type ShippedFlags = Record<Feature, boolean>;

/** Nothing in the core loop is shipped today. */
export const SHIPPED: ShippedFlags = {
  approvalQueue: false,
  autoFill: false,
  handOff: false,
  replyTracking: false,
  encryptedStorage: false,
};

export type Claim = { id: string; pattern: RegExp; feature: Feature };

export const CLAIMS: readonly Claim[] = [
  { id: "approve-every-application", pattern: /\byou approve every application\b/i, feature: "approvalQueue" },
  { id: "stored-encrypted", pattern: /\b(?:stored|kept|saved) encrypted\b|\bencrypted (?:at rest|in storage)\b/i, feature: "encryptedStorage" },
  { id: "auto-fill", pattern: /\bauto-?fill(?:s|ed|ing)?\b/i, feature: "autoFill" },
  { id: "we-fill", pattern: /\bwe fill\b/i, feature: "autoFill" },
  { id: "hand-off", pattern: /\bhands? off\b|\bhand-?off\b|\bhanded off\b/i, feature: "handOff" },
  { id: "tracks-replies", pattern: /\btracks? (?:your )?repl(?:y|ies)\b|\breply tracking\b/i, feature: "replyTracking" },
];

/** A sentence that says it is future, conditional, negated, sample or demo is not a present-tense claim. */
export const HEDGE =
  /\b(?:will|won'?t|would|soon|planned|plans?|once|when|not|never|no|none|nothing|can'?t|cannot|isn'?t|aren'?t|doesn'?t|don'?t|built to|opens?|later|sample|demo|early access|if|until|before|promise|what )\b|n't/i;

/**
 * Known present-tense claims in files owned outside the copy-guard change. Each must be reworded; the guard fails if an
 * entry stops matching, so this list can only shrink.
 */
export const KNOWN_DEBT: readonly { file: string; claim: string; snippet: string }[] = [
  { file: "app/about/page.tsx", claim: "hand-off", snippet: "It hands off to the employer's own form" },
  { file: "components/landing-v3/hero/hero.tsx", claim: "we-fill", snippet: "We fill it in." },
  { file: "components/landing-v3/tour/tour-card.tsx", claim: "hand-off", snippet: "Handed off to" },
];

export type Violation = { claim: string; feature: Feature; sentence: string };

/** Strips imports and comments, then splits into sentences so one hedge cannot excuse a neighbouring claim. */
function sentences(source: string): string[] {
  const text = source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|\s)\/\/[^\n]*/g, "$1")
    .split("\n")
    .filter((l) => !/^\s*(?:import|export\s+\*?.*\sfrom)\b/.test(l))
    .join("\n");
  return text
    .split(/(?<=[.!?])\s+|\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function findClaimViolations(source: string, shipped: ShippedFlags = SHIPPED): Violation[] {
  const out: Violation[] = [];
  for (const sentence of sentences(source)) {
    if (HEDGE.test(sentence)) continue;
    for (const c of CLAIMS) {
      if (!shipped[c.feature] && c.pattern.test(sentence)) out.push({ claim: c.id, feature: c.feature, sentence });
    }
  }
  return out;
}
