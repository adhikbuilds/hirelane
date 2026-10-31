/**
 * Status detection for employer mail: interview | test | rejection | other. Rules only, 0 LLM calls.
 *
 * Order matters and is deliberate:
 *   1. Only the sender's own words count. Quoted history (lines starting ">", "On ... wrote:" onwards, "Original Message"
 *      blocks, forwarded blocks) and the signature (after "-- ") are removed first, so a rejection that quotes an earlier
 *      interview invite stays a rejection, and "unfortunately" in a footer stays nothing.
 *   2. Conditional sentences ("if we would like to interview you ...", "should we decide to schedule ...") are dropped before
 *      looking for an invitation, so an automatic acknowledgement that mentions interviews stays "other".
 *   3. A rejection beats everything else (a rejection often says "thank you for interviewing" or "your assessment").
 *      Then test, then interview. Anything else, including acknowledgements, alerts and out-of-office notices, is "other".
 */
export type InboundKind = 'interview' | 'test' | 'rejection' | 'other';

export function ownWords(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const keep: string[] = [];
  for (const line of lines) {
    if (/^-- ?$/.test(line)) break;
    if (/^\s*-{2,}\s*(original message|forwarded message)\s*-{2,}\s*$/i.test(line)) break;
    if (/^\s*on .{5,120}wrote:\s*$/i.test(line)) break;
    if (/^\s*from:.*\n?/i.test(line) && keep.length > 3 && /^\s*(from|sent|to|subject):/i.test(line)) break;
    if (/^\s*>/.test(line)) continue;
    keep.push(line);
  }
  return keep.join('\n');
}

const sentences = (s: string): string[] => s.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim()).filter(Boolean);
const CONDITIONAL = /\b(?:if|should|in case|once|after you clear|when you (?:clear|complete|pass)|may|might|would like to interview you)\b/i;

const REJECTION = [
  /\b(?:not|n't) (?:be )?(?:moving|going|proceeding|progressing) (?:forward|ahead|further|with)\b/i,
  /\bwill not be (?:moving|proceeding|extending|taking)\b/i,
  /\bwon't be (?:moving|proceeding|hiring|extending|taking)\b/i,
  /\bdecided (?:to|not to) (?:move|go|proceed|pursue|continue|extend)\b.{0,80}\b(?:other|another|candidat|applicant|forward)/i,
  /\b(?:pursue|proceed with|move forward with|go with) (?:other|another) (?:candidate|applicant)/i,
  /\bunfortunately\b[^.!?]{0,80}\b(?:application|candidature|profile|position|role|applying|not (?:able|be|going)|unable|cannot|can't|will not|won't|have to|at this time)\b/i,
  /\bregret (?:to inform|that we|that you)\b|\bwith regret\b/i,
  /\bnot (?:been )?(?:short[- ]?listed|selected|successful)\b/i,
  /\b(?:position|role|vacancy|opening)\b[^.!?]{0,40}\b(?:has been|is now|was|have been) (?:filled|closed|put on hold|cancelled)\b/i,
  /\bno longer under consideration\b|\bcannot take your candidature forward\b|\bunable to (?:offer|move|take|proceed)\b/i,
  /\b(?:not|never) (?:be )?(?:extending an offer|proceeding with your)\b/i,
  /\bdid not meet the (?:threshold|bar|cut-?off)\b/i,
  /\bwe have (?:chosen|selected) to proceed with other\b/i,
  /\bnot (?:be )?hiring you\b/i,
  /\bwithdraw the invitation\b/i,
];
const TEST = [
  /\b(?:online|coding|skills|pre-?employment|technical|aptitude) (?:assessment|test|challenge|exercise)\b|\bonline (?:round|screening)\b/i,
  /\b(?:hacker ?rank|hacker ?earth|codility|codesignal|mettl|amcat|cocubes|coderbyte)\b/i,
  /\btake-?home\b|\bcase study\b/i,
  /\bcomplete the (?:test|assessment|exercise|challenge)\b|\battempt (?:the|it)\b|\bround 1 is an online\b/i,
  /\bcoding (?:test|problem)\b|\bmcq\b/i,
  /\bsubmit (?:a|the|your) (?:short )?(?:case study|assignment|solution|exercise)\b|\bsend us a link to your repository\b/i,
];
const INTERVIEW = [
  /\binterview\b/i,
  /\b(?:phone|video|technical|hr|panel|final) (?:screen|call|round|discussion|conversation)\b/i,
  /\b(?:schedule|set up|arrange|book) (?:a|an|the|your)? ?(?:call|conversation|chat|meeting|discussion|slot)\b/i,
  /\b(?:meet|speak|talk|chat) with (?:you|us|our|two|the)\b|\bwould love to (?:chat|talk|speak|meet)\b|\bwould like to (?:speak|talk|meet|set up)\b/i,
  /\b(?:share|confirm|send) (?:your |two or three )?(?:availability|slots?)\b|\bwhat times work\b|\bpick (?:any )?(?:a )?slot\b|\bselect your preferred\b/i,
  /\bnext round\b|\binterview stage\b|\bcleared the (?:screening|written)\b/i,
  /\bmeet our (?:engineering )?team\b|\bmeet you in person\b/i,
];

const hit = (res: RegExp[], s: string): boolean => res.some((r) => r.test(s));

export function classify(subject: string, text: string): InboundKind {
  const body = ownWords(text);
  // The subject of a reply echoes the thread it answers, so it says nothing new about an invitation or a test.
  const echoed = /^\s*(?:re|fwd?|aw)\s*:/i.test(subject);
  const own = sentences(`${subject}. ${body}`);
  const firm = sentences(`${echoed ? '' : `${subject}. `}${body}`).filter((s) => !CONDITIONAL.test(s)).join(' ');
  const all = own.join(' ');
  // An out-of-office notice is never a rejection, whatever it regrets.
  if (/\bout of office\b|\bautomatic reply\b|\bauto-?reply\b/i.test(subject) || /\bout of (?:the )?office\b/i.test(body)) return 'other';
  if (hit(REJECTION, all)) return 'rejection';
  if (hit(TEST, firm)) return 'test';
  if (hit(INTERVIEW, firm)) return 'interview';
  return 'other';
}
