/** In-process extraction followed by the layout pass. For tests and tools; uploads go through extractInThread. */
import { extractResume } from './index';
import { applyLayout } from './layout';
import type { ExtractResult } from './types';

export async function extractResumeLaidOut(bytes: Uint8Array): Promise<ExtractResult> {
  return applyLayout(await extractResume(bytes));
}
