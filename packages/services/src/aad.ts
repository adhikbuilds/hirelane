/**
 * Sealing conventions shared by services and the runner. Every sealed value is bound to its owner and row, so a
 * blob or envelope copied to another user or row fails to open.
 */
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const KEY_RE = new RegExp(`^resumes/(${UUID})/(${UUID})$`, 'i');

/**
 * These two MUST equal workers/runner/src/tasks/resume-common.ts (fileAad, parsedAad): the runner opens what services seal.
 * The task brief suggested `resume:<uid>:<id>` for the file; the runner already ships `resumes:<id>:<uid>:file`, and a
 * mismatch would make every upload unreadable, so the runner's strings are used. Change both sides together.
 *
 * AAD of the sealed file bytes. `id` is the row that was uploaded (the blob id), not of a later version.
 */
export const resumeBlobAad = (userId: string, id: string): string => `resumes:${id}:${userId}:file`;
/** AAD of `resumes.parsed_enc`. `id` is the row that holds the envelope. */
export const parsedAad = (userId: string, id: string): string => `resumes:${id}:${userId}`;
/** Keyed-hash purpose for resumes.file_hmac (same as the runner's FILE_HMAC_PURPOSE). */
export const FILE_HMAC_PURPOSE = 'resume.file';
export const answerAad = (userId: string, id: string): string => `answer:${userId}:${id}`;
export const collegeAad = (userId: string): string => `college:${userId}`;

export const blobKeyFor = (userId: string, id: string): string => `resumes/${userId}/${id}`;

/** The blob id inside a blob key, or null when the key is not this user's. Versions share their root's blob. */
export function blobIdFromKey(userId: string, key: string): string | null {
  const m = KEY_RE.exec(key);
  return m && m[1]!.toLowerCase() === userId.toLowerCase() ? m[2]! : null;
}
