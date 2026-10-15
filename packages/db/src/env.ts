import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Load `.env.local` (then `.env`) by walking up from the working directory, so the repo-root file
 * is found from a script in packages/db, a worker, or a Next server. Host-provided env wins.
 */
export function loadEnv(): void {
  if (process.env['DATABASE_URL']) return;
  let dir = process.cwd();
  for (let depth = 0; depth < 6; depth++) {
    for (const name of ['.env.local', '.env']) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) {
        config({ path: candidate, quiet: true });
        if (process.env['DATABASE_URL']) return;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

export function requireDatabaseUrl(): string {
  loadEnv();
  const url = process.env['DATABASE_URL'];
  if (!url) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env.local, then run `pnpm db:up`.');
  }
  return url;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export function isLocalUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  // libpq honours ?host= and ?hostaddr= over the authority, so any override must be local too.
  const overrides = [...parsed.searchParams.getAll('host'), ...parsed.searchParams.getAll('hostaddr')];
  return LOCAL_HOSTS.has(parsed.hostname) && overrides.every((h) => LOCAL_HOSTS.has(h));
}
