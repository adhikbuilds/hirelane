"use server";

import { saveEligibility } from "@hirelane/services";
import { runAction } from "@/lib/api/action";

/** Twin of PUT /api/v1/eligibility. Saving counts as the student's confirmation. */
export async function saveEligibilityAction(input: unknown) {
  return runAction((ctx) => saveEligibility(ctx, input));
}
