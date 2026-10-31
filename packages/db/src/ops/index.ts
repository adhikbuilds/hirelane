/**
 * Pilot ops commands (docs/apply.md "Open before pilot" item 5). Run as the owner role through `pnpm ops`, never from the app.
 * Every command is ONE transaction: the change and its `ops_audit` row commit together or not at all. The audit row holds ids,
 * names of campuses and domains, and the old and new setting. It never holds a join code, an address or a keyed hash.
 *
 * The keyed hashes need the vault master key, and this package may not import it (dependency rule db-no-business-logic), so the
 * entry point (scripts/ops/main.ts) passes `codeHmac` and `mailboxHmac` in.
 */
import { parseArgs } from 'node:util';

export interface Queryable {
  query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }>;
}

export interface OpsDeps {
  /** Runs `fn` on one connection as the owner role. */
  run<T>(fn: (c: Queryable) => Promise<T>): Promise<T>;
  /** Who is running this. Recorded on every audit row. */
  actor: string;
  /** Keyed hash of a join code (purpose campus/code). */
  codeHmac(code: string): Promise<string>;
  /** Keyed hash of a normalised mailbox (purpose campus/email), or null when the text is not an address. */
  mailboxHmac(email: string): Promise<string | null>;
  generateCode(): string;
  log(line: string): void;
}

export class OpsError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'OpsError';
    this.code = code;
  }
}

export const PLATFORMS = ['greenhouse', 'lever', 'ashby'] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DOMAIN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
/** Same bounds as campuses_cgpa_rule_bounds (0013b): pct = a * cgpa + b. */
const A_RANGE = [0.5, 20] as const;
const B_RANGE = [-50, 50] as const;
const INVITE_DAYS = 14;

// ------------------------------------------------------------------ validation

const need = (v: string | undefined, flag: string): string => {
  if (v === undefined || v.trim() === '') throw new OpsError('usage', `--${flag} is required`);
  return v;
};
export function parseName(v: string | undefined): string {
  const s = need(v, 'name').trim();
  if (s.length < 2 || s.length > 160) throw new OpsError('invalid', 'the campus name must be 2 to 160 characters');
  return s;
}
export function parseDomain(v: string | undefined): string {
  const s = need(v, 'domain').trim().toLowerCase();
  if (s.length > 120 || !DOMAIN.test(s)) throw new OpsError('invalid', `"${s.slice(0, 60)}" is not a domain name`);
  return s;
}
export function parseCampusId(v: string | undefined): string {
  const s = need(v, 'campus').trim().toLowerCase();
  if (!UUID.test(s)) throw new OpsError('invalid', '--campus must be a campus id (uuid)');
  return s;
}
export interface CgpaRule {
  kind: 'linear';
  a: number;
  b: number;
}
export function parseRule(aRaw: string | undefined, bRaw: string | undefined): CgpaRule {
  const num = (raw: string | undefined, flag: string): number => {
    const s = need(raw, flag).trim();
    const n = /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
    if (!Number.isFinite(n)) throw new OpsError('invalid', `--${flag} must be a number`);
    return n;
  };
  const a = num(aRaw, 'a');
  const b = num(bRaw, 'b');
  if (a < A_RANGE[0] || a > A_RANGE[1]) throw new OpsError('invalid', `--a must be between ${A_RANGE[0]} and ${A_RANGE[1]} (the multiplier in pct = a * cgpa + b)`);
  if (b < B_RANGE[0] || b > B_RANGE[1]) throw new OpsError('invalid', `--b must be between ${B_RANGE[0]} and ${B_RANGE[1]}`);
  return { kind: 'linear', a, b };
}

// ------------------------------------------------------------------ plumbing

async function inTx<T>(c: Queryable, fn: () => Promise<T>): Promise<T> {
  await c.query('BEGIN');
  try {
    const out = await fn();
    await c.query('COMMIT');
    return out;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw mapDbError(e);
  }
}

/** SQLSTATE and constraint name only: a database message can carry values. */
function mapDbError(e: unknown): unknown {
  if (e instanceof OpsError || typeof e !== 'object' || e === null) return e;
  const { code, constraint } = e as { code?: string; constraint?: string };
  if (code === '23505') return new OpsError('conflict', `already exists (${constraint ?? 'unique'})`);
  if (code === '23514') return new OpsError('invalid', `refused by the database (${constraint ?? 'check'})`);
  if (code === '23503') return new OpsError('not_found', 'a referenced record does not exist');
  return new OpsError('db_error', `database error ${code ?? 'unknown'}`);
}

async function audit(c: Queryable, actor: string, command: string, target: string | null, detail: Record<string, unknown>): Promise<void> {
  await c.query('INSERT INTO ops_audit (actor, command, target, detail) VALUES ($1, $2, $3, $4::jsonb)', [actor, command, target, JSON.stringify(detail)]);
}

const requireActor = (d: OpsDeps): string => {
  const a = d.actor.trim();
  if (!a || a.length > 120) throw new OpsError('usage', 'an operator name is required (HIRELANE_OPS_ACTOR)');
  return a;
};

async function campusExists(c: Queryable, id: string, lock = false): Promise<void> {
  const r = await c.query(`SELECT 1 FROM campuses WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [id]);
  if (r.rowCount === 0) throw new OpsError('not_found', 'no such campus');
}

// ------------------------------------------------------------------ commands

export async function createCampus(d: OpsDeps, i: { name: string; domains: string[]; rule: CgpaRule | null }): Promise<{ campusId: string; code: string }> {
  const actor = requireActor(d);
  if (i.domains.length === 0) throw new OpsError('usage', 'at least one --domain is required');
  const domains = [...new Set(i.domains)].sort();
  const code = d.generateCode();
  const codeHmac = await d.codeHmac(code);
  const campusId = await d.run((c) =>
    inTx(c, async () => {
      const r = await c.query('INSERT INTO campuses (name, code_hmac, cgpa_rule) VALUES ($1, $2, $3::jsonb) RETURNING id', [i.name, codeHmac, i.rule ? JSON.stringify(i.rule) : null]);
      const id = r.rows[0].id as string;
      for (const dom of domains) await c.query('INSERT INTO campus_domains (campus_id, domain) VALUES ($1, $2)', [id, dom]);
      await audit(c, actor, 'campus_create', id, { name: i.name, domains, cgpaRule: i.rule });
      return id;
    }),
  );
  return { campusId, code };
}

export async function addDomain(d: OpsDeps, i: { campusId: string; domain: string }): Promise<void> {
  const actor = requireActor(d);
  await d.run((c) =>
    inTx(c, async () => {
      await campusExists(c, i.campusId);
      await c.query('INSERT INTO campus_domains (campus_id, domain) VALUES ($1, $2)', [i.campusId, i.domain]);
      await audit(c, actor, 'domain_add', i.campusId, { domain: i.domain });
    }),
  );
}

export async function removeDomain(d: OpsDeps, i: { campusId: string; domain: string }): Promise<void> {
  const actor = requireActor(d);
  await d.run((c) =>
    inTx(c, async () => {
      await campusExists(c, i.campusId, true);
      const have = (await c.query('SELECT domain::text AS domain FROM campus_domains WHERE campus_id = $1', [i.campusId])).rows.map((r) => r.domain as string);
      if (!have.includes(i.domain)) throw new OpsError('not_found', 'that domain is not registered on this campus');
      // A campus with no domain can verify nobody by college email, so the last one is not removed by accident.
      if (have.length === 1) throw new OpsError('invalid', 'refusing to remove the last domain of a campus');
      await c.query('DELETE FROM campus_domains WHERE campus_id = $1 AND domain = $2', [i.campusId, i.domain]);
      await audit(c, actor, 'domain_remove', i.campusId, { domain: i.domain });
    }),
  );
}

export async function setCgpaRule(d: OpsDeps, i: { campusId: string; rule: CgpaRule | null }): Promise<void> {
  const actor = requireActor(d);
  await d.run((c) =>
    inTx(c, async () => {
      const cur = (await c.query('SELECT cgpa_rule FROM campuses WHERE id = $1 FOR UPDATE', [i.campusId])).rows[0];
      if (!cur) throw new OpsError('not_found', 'no such campus');
      await c.query('UPDATE campuses SET cgpa_rule = $2::jsonb WHERE id = $1', [i.campusId, i.rule ? JSON.stringify(i.rule) : null]);
      await audit(c, actor, 'cgpa_rule_set', i.campusId, { previous: cur.cgpa_rule ?? null, next: i.rule });
    }),
  );
}

export async function issueOwnerInvite(d: OpsDeps, i: { campusId: string; email: string }): Promise<{ memberId: string; reissued: boolean }> {
  const actor = requireActor(d);
  const h = await d.mailboxHmac(i.email);
  if (!h) throw new OpsError('invalid', '--email is not an email address');
  return d.run((c) =>
    inTx(c, async () => {
      await campusExists(c, i.campusId, true);
      const seat = (await c.query('SELECT id, user_id, expires_at > now() AS live FROM tpo_members WHERE campus_id = $1 AND email_hmac = $2 FOR UPDATE', [i.campusId, h])).rows[0];
      let memberId: string;
      let reissued = false;
      if (seat) {
        if (seat.user_id) throw new OpsError('conflict', 'that address already holds a seat on this campus');
        if (seat.live) throw new OpsError('conflict', 'an invite for that address is already open');
        await c.query(`UPDATE tpo_members SET role = 'owner', expires_at = now() + make_interval(days => $2), created_at = now() WHERE id = $1`, [seat.id, INVITE_DAYS]);
        memberId = seat.id as string;
        reissued = true;
      } else {
        const r = await c.query(`INSERT INTO tpo_members (campus_id, email_hmac, role) VALUES ($1, $2, 'owner') RETURNING id`, [i.campusId, h]);
        memberId = r.rows[0].id as string;
      }
      await audit(c, actor, 'owner_invite', i.campusId, { memberId, reissued, expiresInDays: INVITE_DAYS });
      return { memberId, reissued };
    }),
  );
}

export async function setPlatformSwitch(d: OpsDeps, i: { platform: string; enabled: boolean; reason: string | null }): Promise<void> {
  const actor = requireActor(d);
  if (!(PLATFORMS as readonly string[]).includes(i.platform)) throw new OpsError('invalid', `--platform must be one of ${PLATFORMS.join(', ')}`);
  if (i.reason !== null && i.reason.length > 300) throw new OpsError('invalid', '--reason is at most 300 characters');
  await d.run((c) =>
    inTx(c, async () => {
      const cur = (await c.query('SELECT enabled FROM platform_switches WHERE platform = $1 FOR UPDATE', [i.platform])).rows[0];
      // A missing row means "no submitting" to the worker. This command never creates one: that is a migration's job.
      if (!cur) throw new OpsError('not_found', 'no switch row for that platform');
      await c.query('UPDATE platform_switches SET enabled = $2, reason = $3, updated_at = now() WHERE platform = $1', [i.platform, i.enabled, i.reason]);
      await audit(c, actor, 'platform_switch', i.platform, { enabled: i.enabled, previous: cur.enabled === true, reason: i.reason });
    }),
  );
}

// ------------------------------------------------------------------ command line

export const USAGE = `usage: pnpm ops <command> [flags]

  campus create --name <text> --domain <host> [--domain <host> ...] [--cgpa-a <n> --cgpa-b <n>]
  domain add    --campus <id> --domain <host>
  domain remove --campus <id> --domain <host>
  cgpa-rule set --campus <id> (--a <n> --b <n> | --clear)        pct = a * cgpa + b
  owner-invite  --campus <id> --email <address>
  switch set    --platform <greenhouse|lever|ashby> (--on | --off) [--reason <text>]

Every command writes one ops_audit row in the same transaction. Set HIRELANE_OPS_ACTOR to your name.`;

const OPTIONS = {
  name: { type: 'string' },
  domain: { type: 'string', multiple: true },
  campus: { type: 'string' },
  a: { type: 'string' },
  b: { type: 'string' },
  'cgpa-a': { type: 'string' },
  'cgpa-b': { type: 'string' },
  clear: { type: 'boolean' },
  email: { type: 'string' },
  platform: { type: 'string' },
  on: { type: 'boolean' },
  off: { type: 'boolean' },
  reason: { type: 'string' },
} as const;

/** `--b -3` reads as two flags to parseArgs; a negative number after a long flag is that flag's value. */
function joinNegativeValues(args: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const t = args[i]!;
    const next = args[i + 1];
    if (t.startsWith('--') && !t.includes('=') && next !== undefined && /^-\d+(\.\d+)?$/.test(next)) {
      out.push(`${t}=${next}`);
      i++;
    } else out.push(t);
  }
  return out;
}

/** Returns the process exit code: 0 done, 1 refused or failed, 2 usage. */
export async function runOpsCli(argv: readonly string[], d: OpsDeps): Promise<number> {
  const usage = (msg?: string): number => {
    if (msg) d.log(`error: ${msg}`);
    d.log(USAGE);
    return msg ? 2 : 0;
  };
  const [first, second, ...flags] = argv;
  if (first === undefined || first === '--help' || first === '-h') return usage(first === undefined ? 'a command is required' : undefined);
  const twoWord = first === 'campus' || first === 'domain' || first === 'cgpa-rule' || first === 'switch';
  const sub = twoWord ? second : undefined;
  const rest = twoWord ? flags : [second, ...flags].filter((x): x is string => x !== undefined);
  let v: ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: false; strict: true }>>['values'];
  try {
    v = parseArgs({ args: joinNegativeValues(rest), options: OPTIONS, allowPositionals: false, strict: true }).values;
  } catch (e) {
    return usage((e as Error).message);
  }
  try {
    switch (`${first}${sub ? ` ${sub}` : ''}`) {
      case 'campus create': {
        const hasA = v['cgpa-a'] !== undefined;
        const hasB = v['cgpa-b'] !== undefined;
        if (hasA !== hasB) throw new OpsError('usage', '--cgpa-a and --cgpa-b go together');
        const r = await createCampus(d, {
          name: parseName(v.name),
          domains: (v.domain ?? []).map((x) => parseDomain(x)),
          rule: hasA ? parseRule(v['cgpa-a'], v['cgpa-b']) : null,
        });
        d.log(`campus created: id=${r.campusId}`);
        d.log(`join code (shown once, not stored): ${r.code}`);
        return 0;
      }
      case 'domain add':
        await addDomain(d, { campusId: parseCampusId(v.campus), domain: parseDomain(v.domain?.[0]) });
        d.log('domain added');
        return 0;
      case 'domain remove':
        await removeDomain(d, { campusId: parseCampusId(v.campus), domain: parseDomain(v.domain?.[0]) });
        d.log('domain removed');
        return 0;
      case 'cgpa-rule set': {
        const campusId = parseCampusId(v.campus);
        if (v.clear && (v.a !== undefined || v.b !== undefined)) throw new OpsError('usage', 'use either --clear or --a and --b, not both');
        await setCgpaRule(d, { campusId, rule: v.clear ? null : parseRule(v.a, v.b) });
        d.log(v.clear ? 'cgpa rule cleared' : 'cgpa rule set');
        return 0;
      }
      case 'owner-invite': {
        const r = await issueOwnerInvite(d, { campusId: parseCampusId(v.campus), email: need(v.email, 'email') });
        d.log(`owner invite ${r.reissued ? 're-issued' : 'issued'}: member=${r.memberId} (14 days; claimed when the person signs in and calls POST /api/v1/tpo/claim)`);
        return 0;
      }
      case 'switch set': {
        if (v.on === v.off) throw new OpsError('usage', 'give exactly one of --on and --off');
        await setPlatformSwitch(d, { platform: need(v.platform, 'platform'), enabled: v.on === true, reason: v.reason ?? null });
        d.log(`switch ${v.platform}: ${v.on ? 'on' : 'off'}`);
        return 0;
      }
      default:
        return usage(`unknown command "${[first, sub].filter(Boolean).join(' ')}"`);
    }
  } catch (e) {
    if (e instanceof OpsError) {
      d.log(`error: ${e.message}`);
      if (e.code === 'usage') d.log(USAGE);
      return e.code === 'usage' ? 2 : 1;
    }
    d.log('error: unexpected failure');
    return 1;
  }
}
