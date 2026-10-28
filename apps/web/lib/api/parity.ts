/**
 * Every resume and eligibility server action and the /api/v1 operation (operationId in lib/openapi-v1.ts) that does
 * the same thing. The parity test fails when an exported action is missing here or its twin is not in the v1 document.
 * Keyed by file (relative to apps/web) so a new actions.ts cannot be forgotten silently.
 */
export const ACTION_TWINS: Record<string, Record<string, string>> = {
  "app/(app)/resume/actions.ts": {
    confirmResumeAction: "confirmResume",
    deleteResumeAction: "deleteResume",
    saveBuilderStepAction: "saveBuilderStep",
    finishBuilderAction: "finishBuilder",
  },
  "app/(app)/you/eligibility/actions.ts": {
    saveEligibilityAction: "saveEligibility",
  },
};
/** Routes with no action twin by design (uploads are a route handler, PLAN Amendment B section 2; reads go through lib/api/page.ts). */
export const ROUTE_ONLY = ["uploadResume", "downloadResume", "listResumes", "getResume", "getEligibility", "getMe", "exportMe"];
