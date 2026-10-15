import type { IngestMode } from '../contract';
import { parseInject, type InjectMap } from './fixtures';

export interface CliArgs {
  mode: IngestMode;
  fixturesDir?: string;
  inject: InjectMap;
  concurrency?: number;
}

const FLAGS = new Set(['--mode', '--fixtures-dir', '--inject-status', '--concurrency']);

/** Accepts `--flag value` and `--flag=value`; a bare `--` is ignored (pnpm/vite-node pass it through). */
export function parseArgs(argv: string[], env: Record<string, string | undefined> = process.env): CliArgs {
  let mode: string | undefined;
  let fixturesDir: string | undefined;
  let concurrency: number | undefined;
  const injects: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--') continue;
    const eq = a.indexOf('=');
    const flag = eq === -1 ? a : a.slice(0, eq);
    if (!FLAGS.has(flag)) throw new Error(`unknown argument: ${a}`);
    const value = eq === -1 ? argv[++i] : a.slice(eq + 1);
    if (value === undefined || value === '') throw new Error(`${flag} needs a value`);
    if (flag === '--mode') mode = value;
    else if (flag === '--fixtures-dir') fixturesDir = value;
    else if (flag === '--inject-status') injects.push(value);
    else {
      concurrency = Number(value);
      if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32) throw new Error('--concurrency must be an integer 1..32');
    }
  }

  const m = mode ?? env['HIRELANE_INGEST_MODE'] ?? 'fixture';
  if (m !== 'fixture' && m !== 'live') throw new Error(`--mode must be fixture or live, got "${m}"`);
  if (m === 'live' && (fixturesDir !== undefined || injects.length > 0)) {
    throw new Error('--fixtures-dir and --inject-status are fixture mode only');
  }
  return { mode: m, ...(fixturesDir !== undefined ? { fixturesDir } : {}), inject: parseInject(injects), ...(concurrency !== undefined ? { concurrency } : {}) };
}
