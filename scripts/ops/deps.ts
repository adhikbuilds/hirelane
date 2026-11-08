import { userInfo } from 'node:os';
import { isLocalUrl } from '../../packages/db/src/env';
import type { OpsDeps } from '../../packages/db/src/ops/index';
import { findUniversityRule } from '../../packages/engine/src/eligibility/university';
import { EnvKeyProvider } from '../../packages/vault/src/index';
import { campusCodeHmac, generateCampusCode, mailboxHmac, normalizeMailbox } from '../../packages/services/src/campus/codes';

type Env = Record<string, string | undefined>;

export function operatorName(env: Env): string {
  return (env['HIRELANE_OPS_ACTOR'] ?? '').trim() || userInfo().username;
}

/** Ops writes with the owner role, so a database that is not this machine needs an explicit yes. */
export function assertMayRun(databaseUrl: string, env: Env): void {
  if (!isLocalUrl(databaseUrl) && env['HIRELANE_OPS_ALLOW_REMOTE'] !== '1') {
    throw new Error('DATABASE_URL is not a local database. Set HIRELANE_OPS_ALLOW_REMOTE=1 to run ops commands against it.');
  }
}

/**
 * Wires the ops commands (packages/db/src/ops) to the vault and the app's own hash functions, so a join code or an owner seat
 * made here is looked up the way the app looks it up. The master key is read on first use only.
 */
export function buildOpsDeps(o: { env: Env; run: OpsDeps['run']; log: (line: string) => void }): OpsDeps {
  let keys: EnvKeyProvider | undefined;
  const k = (): EnvKeyProvider => (keys ??= new EnvKeyProvider(o.env));
  return {
    run: o.run,
    actor: operatorName(o.env),
    codeHmac: async (code) => campusCodeHmac(k(), code),
    mailboxHmac: async (email) => {
      const m = normalizeMailbox(email);
      return m ? mailboxHmac(k(), m) : null;
    },
    generateCode: () => generateCampusCode(),
    log: o.log,
    universityOf: (name) => {
      const u = findUniversityRule(name);
      return u ? { name: u.short, schemeKeyed: !!u.variants, disputed: !!u.disputed } : null;
    },
  };
}
