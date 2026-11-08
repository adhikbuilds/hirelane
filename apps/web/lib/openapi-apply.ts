/**
 * /api/v1 operations for the apply pipeline (applying a role from the app, owner decision 2026-10-29). Route-only: the student
 * screens read through lib/api/page.ts. openapi-v1.ts spreads APPLY_OPERATIONS into V1_OPERATIONS.
 */
import {
  AnswerBankEntrySchema,
  AnswerBankSchema,
  AnswerDeletedSchema,
  AnswerInput,
  ApplicationDetailSchema,
  ApplicationListSchema,
  ApplySettingsSchema,
  AutoApplyInput,
  InboxReadSchema,
  InboxSchema,
  SwipeInput,
  SwipeResultSchema,
  UndoResultSchema,
  ApplicationRearmedSchema,
  ApplicationFinishedSchema,
} from "@hirelane/services";
import type { V1Operation } from "./openapi-types";

export const APPLY_OPERATIONS: V1Operation[] = [
  {
    operationId: "applyToJob",
    method: "post",
    path: "/api/v1/apply/applications",
    summary: "Apply. Creates the application with a 4 second undo window and queues the submit. Nothing is sent without the auto_apply consent, a free daily slot and an enabled platform.",
    mutation: true,
    request: SwipeInput,
    errors: [409],
    success: { status: 201, schema: SwipeResultSchema, description: "Created (200 when the job was already in progress)" },
  },
  {
    operationId: "swipeRight",
    method: "post",
    path: "/api/v1/apply/swipe",
    summary: "Deprecated: use POST /api/v1/apply/applications. Same behaviour.",
    mutation: true,
    deprecated: true,
    request: SwipeInput,
    errors: [409],
    success: { status: 201, schema: SwipeResultSchema, description: "Created (200 when the job was already in progress)" },
  },
  {
    operationId: "listApplications",
    method: "get",
    path: "/api/v1/apply/applications",
    summary: "The tracker: my applications, newest first",
    mutation: false,
    query: [
      { name: "status", description: "ready, submitting, submitted, blocked_fallback, failed or undone.", type: "string" },
      { name: "limit", description: "1 to 100 (default 50).", type: "integer" },
    ],
    success: { status: 200, schema: ApplicationListSchema, description: "Applications" },
  },
  { operationId: "getApplication", method: "get", path: "/api/v1/apply/applications/{id}", summary: "One application with its answers, receipt and matched employer messages", mutation: false, success: { status: 200, schema: ApplicationDetailSchema, description: "The application" } },
  { operationId: "undoApplication", method: "post", path: "/api/v1/apply/applications/{id}/undo", summary: "Take an application back within 4 seconds", mutation: true, errors: [409], success: { status: 200, schema: UndoResultSchema, description: "Undone" } },
  { operationId: "rearmApplication", method: "post", path: "/api/v1/apply/applications/{id}/rearm", summary: "After answering the question that blocked it (needs_you), put my own application back to ready with a fresh 4 second window and queue the submit again", mutation: true, errors: [404, 409], success: { status: 200, schema: ApplicationRearmedSchema, description: "Re-armed" } },
  { operationId: "markFinishedByStudent", method: "post", path: "/api/v1/apply/applications/{id}/finish", summary: "I finished this blocked application on the employer site: mark my own application submitted by me (nothing was sent by Hirelane)", mutation: true, errors: [404, 409], success: { status: 200, schema: ApplicationFinishedSchema, description: "Marked submitted" } },
  { operationId: "listInbox", method: "get", path: "/api/v1/apply/inbox", summary: "Employer messages forwarded to me, parsed (interview, test, rejection, other)", mutation: false, success: { status: 200, schema: InboxSchema, description: "Messages, newest first" } },
  { operationId: "markInboxRead", method: "put", path: "/api/v1/apply/inbox", summary: "Mark every notification read", mutation: true, success: { status: 200, schema: InboxReadSchema, description: "How many were unread" } },
  { operationId: "listAnswers", method: "get", path: "/api/v1/apply/answers", summary: "My answer bank", mutation: false, success: { status: 200, schema: AnswerBankSchema, description: "Answers" } },
  { operationId: "saveAnswer", method: "put", path: "/api/v1/apply/answers", summary: "Create or replace the answer for a question key", mutation: true, request: AnswerInput, success: { status: 200, schema: AnswerBankEntrySchema, description: "The answer" } },
  { operationId: "deleteAnswer", method: "delete", path: "/api/v1/apply/answers/{id}", summary: "Delete one answer from my answer bank", mutation: true, success: { status: 200, schema: AnswerDeletedSchema, description: "Deleted" } },
  { operationId: "getApplySettings", method: "get", path: "/api/v1/apply/consent", summary: "Whether Hirelane submits for me when I apply, and my apply address", mutation: false, success: { status: 200, schema: ApplySettingsSchema, description: "Settings" } },
  { operationId: "setAutoApply", method: "put", path: "/api/v1/apply/consent", summary: "Switch auto-apply on or off (recorded as a consent)", mutation: true, request: AutoApplyInput, success: { status: 200, schema: ApplySettingsSchema, description: "The new setting" } },
];

export const APPLY_ROUTE_ONLY: string[] = APPLY_OPERATIONS.map((o) => o.operationId);
