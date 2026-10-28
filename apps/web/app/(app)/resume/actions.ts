"use server";

import { confirmResume, deleteResume, finishBuilder, saveBuilderStep } from "@hirelane/services";
import { runAction } from "@/lib/api/action";

/** Confirm the parse: new version plus eligibility profile. Twin of POST /api/v1/resumes/{id}/confirm. */
export async function confirmResumeAction(input: unknown) {
  return runAction((ctx) => confirmResume(ctx, input));
}

/** Twin of DELETE /api/v1/resumes/{id}. */
export async function deleteResumeAction(input: unknown) {
  return runAction((ctx) => deleteResume(ctx, input));
}

/** Twin of POST /api/v1/builder/steps. */
export async function saveBuilderStepAction(input: unknown) {
  return runAction((ctx) => saveBuilderStep(ctx, input));
}

/** Twin of POST /api/v1/builder/finish. */
export async function finishBuilderAction(input: unknown) {
  return runAction((ctx) => finishBuilder(ctx, input));
}
