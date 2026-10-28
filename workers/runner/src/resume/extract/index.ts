/**
 * In-process extraction core. Callers that handle untrusted uploads must use
 * `extractInThread` from ./thread, which runs this inside a resource-limited worker.
 */
import { extractDocx } from './docx';
import { extractPdf } from './pdf';
import { MAX_BYTES, hasKnownMagic, isPdfMagic, isZipMagic } from './limits';
import type { ExtractResult } from './types';

export type { ExtractResult, RejectCode } from './types';

export { MAX_BYTES, hasKnownMagic };

/** Longest extracted text returned to callers (characters). Longer text is truncated. */
export const MAX_TEXT_CHARS = 200_000;

export async function extractResume(bytes: Uint8Array): Promise<ExtractResult> {
  if (!(bytes instanceof Uint8Array)) return { rejected: 'bad_magic' };
  if (bytes.length > MAX_BYTES) return { rejected: 'too_large' };
  try {
    let r: ExtractResult;
    if (isPdfMagic(bytes)) r = await extractPdf(bytes);
    else if (isZipMagic(bytes)) r = extractDocx(bytes);
    else return { rejected: 'bad_magic' };
    // JavaScript or embedded files: refuse rather than just flag. (DOCX never reports JavaScript;
    // that field means "not checked" there.)
    if ('flags' in r && (r.flags.javascript || r.flags.embeddedFiles)) return { rejected: 'active_content' };
    if ('text' in r && r.text.length > MAX_TEXT_CHARS) r = { ...r, text: r.text.slice(0, MAX_TEXT_CHARS) };
    return r;
  } catch {
    // Never forward an error message: it could echo file content.
    return { rejected: 'parse_error' };
  }
}
