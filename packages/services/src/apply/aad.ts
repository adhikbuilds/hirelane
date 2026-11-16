/**
 * Sealing conventions for the apply pipeline. The worker SEALS application answers and inbound excerpts and services OPEN
 * them (and the other way round for the answer bank), so these strings must equal workers/runner/src/tasks/apply-common.ts.
 * Tests on both sides pin the literals; change both together.
 */
/** AAD of application_answers.answer_enc. `id` is the application_answers row. */
export const applyAnswerAad = (userId: string, id: string): string => `applyans:${userId}:${id}`;
/** AAD of application_answers.suggestion_enc: the draft of a free-text answer the engine composed (needs_you, never sent). Sealed JSON string. */
export const applySuggestionAad = (userId: string, id: string): string => `applysug:${userId}:${id}`;
/** AAD of application_answers.evidence_enc. */
export const applyEvidenceAad = (userId: string, id: string): string => `applyev:${userId}:${id}`;
/** AAD of inbound_messages.excerpt_enc (sealed JSON `{ subject, excerpt }`). */
export const inboundAad = (userId: string, id: string): string => `inbound:${userId}:${id}`;
