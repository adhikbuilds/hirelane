import { APPLY_ROUTE_ONLY } from "../openapi-apply";
import { CAMPUS_ROUTE_ONLY } from "../openapi-campus";
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
  "app/(app)/you/actions.ts": {
    deleteMyAccount: "deleteMe",
    setConsent: "setConsent",
  },
};

/**
 * Server actions with no v1 twin, each with the reason. Every actions.ts under app/ must be covered by ACTION_TWINS
 * and/or this list, so a new action cannot ship without a decision.
 */
export const ACTION_EXEMPT: Record<string, Record<string, string>> = {
  "app/(app)/you/actions.ts": { logout: "cookie logout; a Bearer client just discards its token (POST /auth/logout arrives with Bearer, HLD I10)" },
  "app/(auth)/signin/actions.ts": { sendEmailCode: "sign-in ceremony, runs before any session exists; Android signs in through its own auth endpoints (C3)" },
  "app/(auth)/signin/code/actions.ts": { verifyCode: "sign-in ceremony, runs before any session exists" },
  "app/(auth)/welcome/actions.ts": { acceptSignup: "sign-up ceremony, bound to the pending-signup cookie", declineSignup: "sign-up ceremony", getPendingSignup: "sign-up ceremony read" },
  "app/jobs/actions.ts": { loadMoreJobs: "public board reads for the web UI; the public API covers the same data", loadJobPreview: "public board read", suggestJobs: "public board read" },
};
/** Routes with no action twin by design (uploads are a route handler, PLAN Amendment B section 2; reads go through lib/api/page.ts). */
export const ROUTE_ONLY = ["uploadResume", "downloadResume", "listResumes", "getResume", "getEligibility", "getMe", "exportMe", ...CAMPUS_ROUTE_ONLY, ...APPLY_ROUTE_ONLY];
