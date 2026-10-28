/**
 * Zip guard (Amendment B section 2). Runs BEFORE any inflate.
 *
 * - The central directory is parsed here; fflate's one-shot unzip is never used because it
 *   sizes its output buffer from the declared (attacker-controlled) uncompressed size.
 * - Only an allow-list of parts is inflated, in small input slices, with real running byte
 *   counts and caps. Declared sizes are never trusted.
 * - `inflatedBytes` in a failure is the number of bytes actually accepted, never above the cap.
 *
 * Failure codes carry no file content.
 */
import { Inflate } from 'fflate';

export interface GuardLimits {
  maxEntries: number;
  maxEntryBytes: number;
  maxTotalBytes: number;
  /** Inflated bytes allowed per compressed byte actually consumed. */
  maxRatio: number;
}

export const DEFAULT_LIMITS: GuardLimits = {
  maxEntries: 300,
  maxEntryBytes: 10 * 1024 * 1024,
  maxTotalBytes: 25 * 1024 * 1024,
  maxRatio: 200,
};

/** Input slice fed to the inflater. Deflate expands at most about 1032x, so this bounds transient output. */
const SLICE = 1024;
/** The ratio check only applies once an entry has produced more than this, to avoid noise on tiny parts. */
const RATIO_FLOOR = 64 * 1024;

export type GuardFailure = {
  ok: false;
  code: 'zip_guard' | 'macro' | 'parse_error';
  inflatedBytes: number;
};

export type GuardSuccess = {
  ok: true;
  /** Inflated allow-listed parts by entry name. */
  parts: Map<string, Uint8Array>;
  /** Count of entries under word/media/. */
  mediaCount: number;
  /** Count of entries under word/embeddings/ (flagged, never read). */
  embeddedCount: number;
  inflatedBytes: number;
};

export type GuardResult = GuardSuccess | GuardFailure;

interface CdEntry {
  name: string;
  flags: number;
  method: number;
  compSize: number;
  localOffset: number;
}

const ALLOWED = [
  /^\[Content_Types\]\.xml$/,
  /^word\/document\.xml$/,
  /^word\/_rels\/document\.xml\.rels$/,
  /^word\/header\d*\.xml$/,
  /^word\/footer\d*\.xml$/,
  /^docProps\/core\.xml$/,
];

const NESTED_ARCHIVE = /\.(zip|docx|docm|dotx|dotm|xlsx|xlsm|pptx|pptm|jar|apk|7z|rar|gz|tgz|tar|bz2|xz)$/i;

const fail = (code: GuardFailure['code'], inflatedBytes = 0): GuardFailure => ({
  ok: false,
  code,
  inflatedBytes,
});

const u16 = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8);
const u32 = (b: Uint8Array, o: number) =>
  (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;

function findEocd(b: Uint8Array): number {
  const min = Math.max(0, b.length - 22 - 0xffff);
  for (let i = b.length - 22; i >= min; i--) {
    if (b[i] === 0x50 && b[i + 1] === 0x4b && b[i + 2] === 0x05 && b[i + 3] === 0x06) return i;
  }
  return -1;
}

type CdParse = { entries: CdEntry[] } | { fail: GuardFailure };

function readCentralDirectory(b: Uint8Array, limits: GuardLimits): CdParse {
  const eocd = findEocd(b);
  if (eocd < 0) return { fail: fail('parse_error') };
  const total = u16(b, eocd + 10);
  const cdSize = u32(b, eocd + 12);
  const cdOffset = u32(b, eocd + 16);
  // ZIP64 markers: refuse rather than interpret.
  if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) return { fail: fail('zip_guard') };
  if (total > limits.maxEntries) return { fail: fail('zip_guard') };
  if (cdOffset + cdSize > eocd) return { fail: fail('parse_error') };

  const entries: CdEntry[] = [];
  const seen = new Set<string>();
  let p = cdOffset;
  for (let i = 0; i < total; i++) {
    if (p + 46 > b.length || u32(b, p) !== 0x02014b50) return { fail: fail('parse_error') };
    const nameLen = u16(b, p + 28);
    const extraLen = u16(b, p + 30);
    const commentLen = u16(b, p + 32);
    if (p + 46 + nameLen > b.length) return { fail: fail('parse_error') };
    let name = '';
    for (let k = 0; k < nameLen; k++) name += String.fromCharCode(b[p + 46 + k]!);
    if (seen.has(name)) return { fail: fail('zip_guard') }; // duplicate names: parser differential
    seen.add(name);
    entries.push({
      name,
      flags: u16(b, p + 8),
      method: u16(b, p + 10),
      compSize: u32(b, p + 20),
      localOffset: u32(b, p + 42),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  if (p > eocd) return { fail: fail('parse_error') };
  return { entries };
}

function isAllowed(name: string): boolean {
  return ALLOWED.some((re) => re.test(name));
}

function badName(name: string): boolean {
  return (
    name.length === 0 ||
    name.startsWith('/') ||
    name.includes('\\') ||
    name.includes('\0') ||
    name.split('/').includes('..')
  );
}

/** Inflate one entry with real caps. Returns bytes or a failure. */
function inflateEntry(
  b: Uint8Array,
  e: CdEntry,
  limits: GuardLimits,
  totalSoFar: number,
): { data: Uint8Array; produced: number } | GuardFailure {
  const off = e.localOffset;
  if (off + 30 > b.length || u32(b, off) !== 0x04034b50) return fail('parse_error', 0);
  const start = off + 30 + u16(b, off + 26) + u16(b, off + 28);
  if (start > b.length) return fail('parse_error', 0);
  const end = Math.min(start + e.compSize, b.length);
  const room = Math.min(limits.maxEntryBytes, limits.maxTotalBytes - totalSoFar);

  if (e.method === 0) {
    const n = end - start;
    if (n > room) return fail('zip_guard', room);
    return { data: b.slice(start, end), produced: n };
  }
  if (e.method !== 8) return fail('zip_guard', 0);

  const chunks: Uint8Array[] = [];
  let produced = 0;
  let overflow = false;
  const inf = new Inflate((chunk) => {
    if (overflow) return;
    if (produced + chunk.length > room) {
      overflow = true;
      produced = room; // count only what we would have accepted; the excess is dropped
      return;
    }
    produced += chunk.length;
    chunks.push(chunk);
  });
  let fed = 0;
  try {
    for (let pos = start; pos < end; pos += SLICE) {
      const stop = Math.min(pos + SLICE, end);
      inf.push(b.subarray(pos, stop), stop === end);
      fed += stop - pos;
      if (overflow) return fail('zip_guard', produced);
      if (produced > RATIO_FLOOR && produced > limits.maxRatio * fed) return fail('zip_guard', produced);
    }
  } catch {
    return fail('parse_error', Math.min(produced, room));
  }
  if (end === start) return { data: new Uint8Array(0), produced: 0 };
  const data = new Uint8Array(produced);
  let o = 0;
  for (const c of chunks) {
    data.set(c, o);
    o += c.length;
  }
  return { data, produced };
}

export function guardAndInflate(bytes: Uint8Array, limits: GuardLimits = DEFAULT_LIMITS): GuardResult {
  const cd = readCentralDirectory(bytes, limits);
  if ('fail' in cd) return cd.fail;

  let mediaCount = 0;
  let embeddedCount = 0;
  // Name-based checks first: nothing has been inflated yet.
  for (const e of cd.entries) {
    const lower = e.name.toLowerCase();
    const base = lower.slice(lower.lastIndexOf('/') + 1);
    if (base === 'vbaproject.bin' || base === 'vbadata.xml' || lower.endsWith('.docm')) return fail('macro');
  }
  for (const e of cd.entries) {
    if (badName(e.name)) return fail('zip_guard');
    if (e.flags & 1) return fail('zip_guard'); // encrypted entry
    if (e.name.startsWith('word/media/')) mediaCount++;
    if (e.name.startsWith('word/embeddings/')) embeddedCount++;
    if (NESTED_ARCHIVE.test(e.name)) return fail('zip_guard');
  }

  const parts = new Map<string, Uint8Array>();
  let total = 0;
  for (const e of cd.entries) {
    if (!isAllowed(e.name) || e.name.endsWith('/')) continue;
    const r = inflateEntry(bytes, e, limits, total);
    if (!('data' in r)) return { ...r, inflatedBytes: total + r.inflatedBytes };
    total += r.produced;
    parts.set(e.name, r.data);
  }
  return { ok: true, parts, mediaCount, embeddedCount, inflatedBytes: total };
}
