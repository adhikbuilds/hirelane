/**
 * Runs extraction in a fresh CHILD PROCESS per job (not a worker thread), so a hostile file can
 * only take down that child:
 *   - stripped environment (no secrets, no DB URL),
 *   - V8 heap, young generation and stack limits via node flags,
 *   - an RSS watchdog (pdf.js decodes streams into ArrayBuffers outside the V8 heap, so the heap
 *     cap alone cannot stop a Flate bomb),
 *   - Node permission model: no child processes, no workers, and filesystem READ limited to the
 *     workspace (no write at all). Node's permission model does not restrict the network; run the
 *     runner in a network-isolated container for that layer.
 *   - 10 s wall clock, then SIGKILL.
 * The size and magic checks run in the parent BEFORE the bytes are copied or sent.
 *
 * Needs Node >= 22.18 (or >= 23.6): the child is a .ts file loaded by native type stripping, with
 * module.registerHooks resolving extensionless imports. On older Node, extractInThread throws
 * rather than silently rejecting every upload.
 * Errors map to reject codes and never carry file content.
 */
import { execFile, fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MAX_BYTES, hasKnownMagic } from './limits';
import type { ExtractResult, RejectCode } from './types';

const CHILD_ENTRY = new URL('./child.ts', import.meta.url);
export const THREAD_TIMEOUT_MS = 10_000;
const MAX_OLD_GEN_MB = 256;
const SEMI_SPACE_MB = 8;
const STACK_KB = 984;
export const MAX_CHILD_RSS_MB = 640;
const RSS_POLL_MS = 100;

/** True when this Node can load the child (type stripping on by default + registerHooks). */
export function nodeSupportsExtraction(version: string = process.versions.node): boolean {
  const [maj = 0, min = 0] = version.split('.').map((n) => parseInt(n, 10));
  if (maj > 23) return true;
  if (maj === 23) return min >= 6;
  if (maj === 22) return min >= 18;
  return false;
}

const CODES: ReadonlySet<string> = new Set<RejectCode>([
  'too_large',
  'bad_magic',
  'encrypted',
  'too_many_pages',
  'zip_guard',
  'macro',
  'active_content',
  'doctype',
  'parse_error',
  'timeout',
]);

function isResult(v: unknown): v is ExtractResult {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  if (typeof o.rejected === 'string') return CODES.has(o.rejected);
  return (o.kind === 'pdf' || o.kind === 'docx') && typeof o.text === 'string';
}

export interface ThreadOptions {
  timeoutMs?: number;
  /** Kill the child when its resident set exceeds this many MB. */
  maxRssMb?: number;
}

function readRssMb(pid: number): Promise<number | null> {
  return new Promise((resolve) => {
    execFile('ps', ['-o', 'rss=', '-p', String(pid)], { timeout: 2000 }, (err, out) => {
      const kb = err ? NaN : parseInt(String(out).trim(), 10);
      resolve(Number.isFinite(kb) ? kb / 1024 : null);
    });
  });
}

export function extractInThread(bytes: Uint8Array, opts: ThreadOptions = {}): Promise<ExtractResult> {
  if (!nodeSupportsExtraction()) {
    return Promise.reject(new Error(`resume extraction needs Node >= 22.18 (running ${process.versions.node})`));
  }
  if (!(bytes instanceof Uint8Array)) return Promise.resolve({ rejected: 'bad_magic' });
  // Gate before any copy: oversized or unrecognised input never reaches a child.
  if (bytes.length > MAX_BYTES) return Promise.resolve({ rejected: 'too_large' });
  if (!hasKnownMagic(bytes)) return Promise.resolve({ rejected: 'bad_magic' });
  const timeoutMs = opts.timeoutMs ?? THREAD_TIMEOUT_MS;
  const maxRssMb = opts.maxRssMb ?? MAX_CHILD_RSS_MB;
  const entry = fileURLToPath(CHILD_ENTRY);
  const root = fileURLToPath(new URL('../../../../../', import.meta.url));

  return new Promise<ExtractResult>((resolve) => {
    let settled = false;
    let child: ChildProcess | undefined;
    let poll: ReturnType<typeof setInterval> | undefined;
    const settle = (r: ExtractResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (poll) clearInterval(poll);
      child?.kill('SIGKILL');
      resolve(r);
    };
    const timer = setTimeout(() => settle({ rejected: 'timeout' }), timeoutMs);
    try {
      child = fork(entry, [], {
        env: {},
        serialization: 'advanced',
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        execArgv: [
          `--max-old-space-size=${MAX_OLD_GEN_MB}`,
          `--max-semi-space-size=${SEMI_SPACE_MB}`,
          `--stack-size=${STACK_KB}`,
          '--permission',
          `--allow-fs-read=${root}`,
        ],
      });
    } catch {
      settle({ rejected: 'parse_error' });
      return;
    }
    const c = child;
    c.once('message', (m: unknown) => settle(isResult(m) ? m : { rejected: 'parse_error' }));
    // Out-of-memory, crashes and early exits all land here; no message text is forwarded.
    c.once('error', () => settle({ rejected: 'parse_error' }));
    c.once('exit', () => settle({ rejected: 'parse_error' }));
    let polling = false;
    poll = setInterval(() => {
      if (polling || settled || c.pid === undefined) return;
      polling = true;
      void readRssMb(c.pid).then((mb) => {
        polling = false;
        if (mb !== null && mb > maxRssMb) settle({ rejected: 'parse_error' });
      });
    }, RSS_POLL_MS);
    // A private copy goes over IPC; the caller's buffer is untouched.
    c.send(bytes, (err) => {
      if (err) settle({ rejected: 'parse_error' });
    });
  });
}
