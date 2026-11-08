import type { ApplicationSummary } from "@hirelane/services";
import type { TrackerItem } from "@/lib/sample/loop";
import { daysBetween, stepTime } from "./ist";

/** A submitted application with no reply for this many days is shown as quiet. */
export const QUIET_AFTER_DAYS = 6;

type Step = TrackerItem["steps"][number];

/**
 * Applications as Tracker cards.
 *  - undone: not shown (the student took it back).
 *  - ready, submitting: "Opened by you" with a step saying Hirelane is sending it.
 *  - blocked_fallback: "Opened by you" with the step "Finish on their site" (not done): the answers are ready.
 *  - failed: same column, step "Could not be sent" (not done). Nothing is hidden.
 *  - submitted: by the last reply: interview => Interview; test, other => Reply; rejection => Not this time (filed
 *    quietly, no column); no reply after QUIET_AFTER_DAYS => Quiet; otherwise Opened by you.
 * No offer state exists here: offers come from outcomes, not applications.
 */
export function toTrackerItems(apps: ApplicationSummary[], now: Date): TrackerItem[] {
  const out: TrackerItem[] = [];
  for (const a of apps) {
    if (a.status === "undone") continue;
    const created = new Date(a.createdAt);
    const steps: Step[] = [{ at: stepTime(created, now), text: "You applied", done: true }];
    let state: TrackerItem["state"] = "handed_off";

    if (a.status === "ready" || a.status === "submitting") {
      steps.push({ at: "Now", text: "Hirelane is sending it", done: false });
    } else if (a.status === "blocked_fallback") {
      steps.push({ at: "Now", text: a.fallback?.message ?? "Finish on their site", done: false });
    } else if (a.status === "failed") {
      steps.push({ at: "Now", text: "Could not be sent", done: false });
    } else {
      const sent = a.submittedAt ? new Date(a.submittedAt) : created;
      steps.push({ at: stepTime(sent, now), text: "Sent on their form, with your Hirelane address", done: true });
      if (a.lastReply === "interview") {
        state = "interview";
        steps.push({ at: "Latest", text: "They want to interview you", done: true });
      } else if (a.lastReply === "test") {
        state = "replied";
        steps.push({ at: "Latest", text: "They sent a test", done: true });
      } else if (a.lastReply === "other") {
        state = "replied";
        steps.push({ at: "Latest", text: "They wrote back", done: true });
      } else if (a.lastReply === "rejection") {
        state = "not_this_time";
        steps.push({ at: "Latest", text: "Not this time", done: true });
      } else if (daysBetween(sent, now) >= QUIET_AFTER_DAYS) {
        state = "quiet";
      }
    }

    out.push({ id: a.id, company: a.company, initial: (a.company.trim()[0] ?? "?").toUpperCase(), role: a.title, state, steps });
  }
  return out;
}
