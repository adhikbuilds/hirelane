/** Shared service layer (PLAN Amendment B §11): one function per feature, called by server actions and /api/v1. */
export { createServiceCtx, type CreateServiceCtxInput, type Enqueue, type EnqueueOptions, type ServiceCtx } from './ctx';
export { withUserTx, type UserClient } from './db';
export { isServiceError, mapPgError, notFound, ServiceError, toProblem, type Issue, type Problem } from './errors';
export { idPayload, idSchema, parseInput, type JobPayload } from './schema';
export { answerAad, blobIdFromKey, blobKeyFor, collegeAad, FILE_HMAC_PURPOSE, parsedAad, resumeBlobAad } from './aad';
export { ParsedResume } from './parsed';
export { BUILDER_REQUIRED, BUILDER_STEPS, BuilderAnswersSchema, StepData, type BuilderStep } from './builder-steps';
export { openJson, sealJson } from './seal';
export {
  confirmResume,
  deleteResume,
  DOCX_MIME,
  downloadResume,
  getResume,
  listResumes,
  magicMatches,
  MAX_RESUME_BYTES,
  PDF_MIME,
  RESUME_MIMES,
  uploadResume,
  type Download,
  type ResumeSummary,
  type ResumeView,
} from './resumes';
export { ELIGIBILITY_FIELDS, EligibilityValues, FieldMeta, getEligibility, saveEligibility, type EligibilityField, type EligibilityView } from './eligibility';
export { finishBuilder, saveBuilderStep, type BuilderState } from './builder';
export { exportMe, getMe, type Me } from './me';
export { fingerprint, IDEMPOTENCY_KEY_RE, runIdempotent, type Replayable } from './idempotency';
export { UploadInput, IdInput, ConfirmInput } from './resumes';
export { SaveInput } from './eligibility';
export { StepInput, FinishInput } from './builder';
export * from './views';
