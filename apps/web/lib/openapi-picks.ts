/**
 * /api/v1 operations for today's picks and paste-a-job (P0-2, P0-3). Route-only: the student screens read through
 * lib/api/page.ts. openapi-v1.ts spreads PICKS_OPERATIONS into V1_OPERATIONS.
 */
import { PasteInput, PasteResultSchema, PicksSchema } from "@hirelane/services";
import type { V1Operation } from "./openapi-types";

export const PICKS_OPERATIONS: V1Operation[] = [
  {
    operationId: "getPicks",
    method: "get",
    path: "/api/v1/picks",
    summary:
      "Today's ranked roles for me, at most 10: posted under 14 days ago, worthwhile, de-duplicated. A role whose stated academic rule I fail never appears; a rule that could not be checked appears with its reason. Each pick carries the rules with the maths, pay as stated or 'not stated', who I know there when a source exists, and how long ago it was posted. My data only; nothing is stored.",
    mutation: false,
    success: { status: 200, schema: PicksSchema, description: "Today's picks (empty and placed: true for a placed student)" },
  },
  {
    operationId: "checkPastedJob",
    method: "post",
    path: "/api/v1/paste",
    summary:
      "Paste a job from outside: fit, eligibility with the maths, and a scam check, using my own confirmed profile. Nothing is stored and the link is never fetched. Limited to 20 pastes per 10 minutes. No Idempotency-Key: there is nothing to replay.",
    mutation: true,
    idempotent: false,
    request: PasteInput,
    success: { status: 200, schema: PasteResultSchema, description: "The verdict" },
  },
];

export const PICKS_ROUTE_ONLY: string[] = PICKS_OPERATIONS.map((o) => o.operationId);
