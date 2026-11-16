import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations } from '../src/migrator.js';
import { runOpsCli, type OpsDeps } from '../src/ops/index.js';
import { mkUser } from './auth-helpers.js';
import { freshTestClient } from './helpers.js';

/** The pilot ops CLI (packages/db/src/ops). Every command writes one ops_audit row in the same transaction. Synthetic data only. */
let c: Client;
beforeAll(async () => {
  c = await freshTestClient();
  await applyMigrations(c, resolve(import.meta.dirname, '../migrations'));
});
afterAll(async () => {
  await c.end();
});

const fakeHash = (s: string): string => `hm-${Buffer.from(s).toString('hex')}`;
let codeN = 0;
function deps(over: Partial<OpsDeps> = {}): OpsDeps & { lines: string[] } {
  const lines: string[] = [];
  return {
    run: async (fn) => fn(c),
    actor: 'ops-tester',
    codeHmac: async (code) => fakeHash(`code:${code}`),
    mailboxHmac: async (email) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? fakeHash(`mail:${email.trim().toLowerCase()}`) : null),
    generateCode: () => `CODE${String(++codeN).padStart(4, '0')}`,
    log: (l) => void lines.push(l),
    lines,
    ...over,
  };
}
const audit = async (command?: string) =>
  (await c.query('SELECT actor, command, target, detail FROM ops_audit WHERE ($1::text IS NULL OR command = $1) ORDER BY at, id', [command ?? null])).rows;
const auditCount = async (): Promise<number> => (await c.query('SELECT count(*)::int AS n FROM ops_audit')).rows[0].n;
const domainOfCampus = async (id: string): Promise<string[]> => (await c.query('SELECT domain::text FROM campus_domains WHERE campus_id = $1 ORDER BY domain', [id])).rows.map((r) => r.domain);
const uniqueName = (): string => `Ops College ${randomUUID().slice(0, 8)}`;
const uniqueDomain = (): string => `ops-${randomUUID().slice(0, 8)}.example.test`;

async function newCampus(d = deps(), extra: string[] = []): Promise<string> {
  const code = await runOpsCli(['campus', 'create', '--name', uniqueName(), '--domain', uniqueDomain(), ...extra], d);
  expect(code).toBe(0);
  return (await c.query('SELECT id FROM campuses ORDER BY created_at DESC LIMIT 1')).rows[0].id as string;
}

describe('campus create', () => {
  it('creates the campus with a join code (printed once, stored only as a keyed hash), its domains, and one audit row', async () => {
    const d = deps();
    const name = uniqueName();
    const dom1 = uniqueDomain();
    const dom2 = uniqueDomain();
    const before = await auditCount();
    expect(await runOpsCli(['campus', 'create', '--name', name, '--domain', dom1, '--domain', dom2.toUpperCase()], d)).toBe(0);
    const row = (await c.query('SELECT id, code_hmac, cgpa_rule FROM campuses WHERE name = $1', [name])).rows[0];
    expect(row.code_hmac).toBe(fakeHash('code:CODE' + String(codeN).padStart(4, '0')));
    expect(row.cgpa_rule).toBeNull();
    expect(await domainOfCampus(row.id)).toEqual([dom1, dom2].sort());
    const printed = d.lines.join('\n');
    expect(printed).toContain(`CODE${String(codeN).padStart(4, '0')}`);
    expect(printed).toContain(row.id);
    expect(await auditCount()).toBe(before + 1);
    const a = (await audit('campus_create')).at(-1)!;
    expect(a).toMatchObject({ actor: 'ops-tester', command: 'campus_create', target: row.id });
    expect(a.detail).toMatchObject({ name, domains: [dom1, dom2].sort() });
    expect(JSON.stringify(a)).not.toContain('CODE0'); // the code is never in the audit trail
    expect(JSON.stringify(a)).not.toContain(row.code_hmac);
  });

  it('can set the CGPA rule at creation', async () => {
    const d = deps();
    const name = uniqueName();
    expect(await runOpsCli(['campus', 'create', '--name', name, '--domain', uniqueDomain(), '--cgpa-a', '9.5', '--cgpa-b', '0'], d)).toBe(0);
    expect((await c.query('SELECT cgpa_rule FROM campuses WHERE name = $1', [name])).rows[0].cgpa_rule).toEqual({ kind: 'linear', a: 9.5, b: 0 });
  });

  it('a bad name, a bad domain, a taken domain or a missing field changes nothing and writes no audit row', async () => {
    const taken = uniqueDomain();
    expect(await runOpsCli(['campus', 'create', '--name', uniqueName(), '--domain', taken], deps())).toBe(0);
    const audits = await auditCount();
    const campuses = async (): Promise<number> => (await c.query('SELECT count(*)::int AS n FROM campuses')).rows[0].n;
    const n0 = await campuses();
    for (const argv of [
      ['campus', 'create', '--name', 'X', '--domain', uniqueDomain()],
      ['campus', 'create', '--name', uniqueName(), '--domain', 'not a domain'],
      ['campus', 'create', '--name', uniqueName(), '--domain', taken],
      ['campus', 'create', '--name', uniqueName()],
      ['campus', 'create', '--domain', uniqueDomain()],
      ['campus', 'create', '--name', uniqueName(), '--domain', uniqueDomain(), '--cgpa-a', '10'],
    ]) {
      const d = deps();
      expect(await runOpsCli(argv, d), argv.join(' ')).not.toBe(0);
      expect(d.lines.join('\n')).toMatch(/error/i);
    }
    expect(await auditCount()).toBe(audits);
    expect(await campuses()).toBe(n0);
  });

  it('a campus insert that fails halfway leaves no campus behind (one transaction)', async () => {
    const taken = uniqueDomain();
    expect(await runOpsCli(['campus', 'create', '--name', uniqueName(), '--domain', taken], deps())).toBe(0);
    const name = uniqueName();
    expect(await runOpsCli(['campus', 'create', '--name', name, '--domain', uniqueDomain(), '--domain', taken], deps())).not.toBe(0);
    expect((await c.query('SELECT 1 FROM campuses WHERE name = $1', [name])).rowCount).toBe(0);
  });
});

describe('domain add and remove', () => {
  it('adds a domain and removes it, one audit row each, normalised to lower case', async () => {
    const campus = await newCampus();
    const dom = uniqueDomain();
    const n0 = await auditCount();
    expect(await runOpsCli(['domain', 'add', '--campus', campus, '--domain', dom.toUpperCase()], deps())).toBe(0);
    expect(await domainOfCampus(campus)).toContain(dom);
    expect(await runOpsCli(['domain', 'remove', '--campus', campus, '--domain', dom], deps())).toBe(0);
    expect(await domainOfCampus(campus)).not.toContain(dom);
    expect(await auditCount()).toBe(n0 + 2);
    const rows = await audit();
    expect(rows.slice(-2).map((r) => [r.command, r.target, r.detail.domain])).toEqual([['domain_add', campus, dom], ['domain_remove', campus, dom]]);
  });

  it('refuses a domain that another campus holds, an unknown campus, a domain not on this campus, and removing the last domain', async () => {
    const a = await newCampus();
    const b = await newCampus();
    const bDomain = (await domainOfCampus(b))[0]!;
    const n0 = await auditCount();
    const cases: string[][] = [
      ['domain', 'add', '--campus', a, '--domain', bDomain],
      ['domain', 'add', '--campus', randomUUID(), '--domain', uniqueDomain()],
      ['domain', 'add', '--campus', 'not-a-uuid', '--domain', uniqueDomain()],
      ['domain', 'remove', '--campus', a, '--domain', bDomain],
      ['domain', 'remove', '--campus', a, '--domain', (await domainOfCampus(a))[0]!],
    ];
    for (const argv of cases) expect(await runOpsCli(argv, deps()), argv.join(' ')).not.toBe(0);
    expect(await auditCount()).toBe(n0);
    expect((await domainOfCampus(a)).length).toBe(1);
  });
});

describe('cgpa_rule', () => {
  it('sets a linear rule and clears it, recording the old and new rule', async () => {
    const campus = await newCampus();
    expect(await runOpsCli(['cgpa-rule', 'set', '--campus', campus, '--a', '9.5', '--b', '-3'], deps())).toBe(0);
    expect((await c.query('SELECT cgpa_rule FROM campuses WHERE id = $1', [campus])).rows[0].cgpa_rule).toEqual({ kind: 'linear', a: 9.5, b: -3 });
    expect(await runOpsCli(['cgpa-rule', 'set', '--campus', campus, '--a', '10', '--b', '0'], deps())).toBe(0);
    expect(await runOpsCli(['cgpa-rule', 'set', '--campus', campus, '--clear'], deps())).toBe(0);
    expect((await c.query('SELECT cgpa_rule FROM campuses WHERE id = $1', [campus])).rows[0].cgpa_rule).toBeNull();
    const rows = (await audit('cgpa_rule_set')).filter((r) => r.target === campus);
    expect(rows).toHaveLength(3);
    expect(rows[0]!.detail).toMatchObject({ previous: null, next: { kind: 'linear', a: 9.5, b: -3 } });
    expect(rows[1]!.detail).toMatchObject({ previous: { a: 9.5, b: -3 }, next: { a: 10, b: 0 } });
    expect(rows[2]!.detail).toMatchObject({ previous: { a: 10, b: 0 }, next: null });
  });

  it.each([
    ['a zero multiplier', ['--a', '0', '--b', '0']],
    ['a huge multiplier', ['--a', '21', '--b', '0']],
    ['a huge offset', ['--a', '10', '--b', '500']],
    ['not numbers', ['--a', 'ten', '--b', '0']],
    ['a missing offset', ['--a', '10']],
    ['both a rule and --clear', ['--a', '10', '--b', '0', '--clear']],
  ])('refuses %s and changes nothing', async (_n, args) => {
    const campus = await newCampus();
    const n0 = await auditCount();
    expect(await runOpsCli(['cgpa-rule', 'set', '--campus', campus, ...args], deps())).not.toBe(0);
    expect((await c.query('SELECT cgpa_rule FROM campuses WHERE id = $1', [campus])).rows[0].cgpa_rule).toBeNull();
    expect(await auditCount()).toBe(n0);
  });

  describe('a single linear rule on a scheme-keyed or disputed university', () => {
    // db may not import the engine, so the scripts entry point passes the lookup in; this stands in for it.
    const universityOf: NonNullable<OpsDeps['universityOf']> = (name) =>
      /vtu/i.test(name) ? { name: 'VTU', schemeKeyed: true, disputed: false } : /mumbai/i.test(name) ? { name: 'Mumbai', schemeKeyed: false, disputed: true } : /rgpv/i.test(name) ? { name: 'RGPV', schemeKeyed: false, disputed: false } : null;
    const campusNamed = async (name: string): Promise<string> => {
      const r = await c.query("INSERT INTO campuses (name, code_hmac) VALUES ($1, $2) RETURNING id", [`${name} ${randomUUID().slice(0, 6)}`, fakeHash(randomUUID())]);
      return r.rows[0].id as string;
    };
    const ruleOf = async (id: string) => (await c.query('SELECT cgpa_rule FROM campuses WHERE id = $1', [id])).rows[0].cgpa_rule;

    it.each([['Test Institute affiliated to VTU'], ['College of University of Mumbai']])('refuses on "%s" without --force-unverified and writes nothing', async (name) => {
      const campus = await campusNamed(name);
      const n0 = await auditCount();
      const d = deps({ universityOf });
      expect(await runOpsCli(['cgpa-rule', 'set', '--campus', campus, '--a', '10', '--b', '0'], d)).toBe(1);
      expect(d.lines.join(' ')).toMatch(/force-unverified/);
      expect(await ruleOf(campus)).toBeNull();
      expect(await auditCount()).toBe(n0);
    });

    it('with --force-unverified it writes, flags the rule unverified and still writes an audit row saying so', async () => {
      const campus = await campusNamed('Test Institute affiliated to VTU');
      const n0 = await auditCount();
      expect(await runOpsCli(['cgpa-rule', 'set', '--campus', campus, '--a', '10', '--b', '0', '--force-unverified'], deps({ universityOf }))).toBe(0);
      expect(await ruleOf(campus)).toEqual({ kind: 'linear', a: 10, b: 0, unverified: true });
      expect(await auditCount()).toBe(n0 + 1);
      const row = (await audit('cgpa_rule_set')).filter((r) => r.target === campus)[0]!;
      expect(row.detail).toMatchObject({ forceUnverified: true, university: 'VTU', next: { a: 10, b: 0, unverified: true } });
    });

    it('a university that is neither keyed nor disputed needs no flag, and the flag does not mark the rule', async () => {
      const campus = await campusNamed('Some RGPV college');
      expect(await runOpsCli(['cgpa-rule', 'set', '--campus', campus, '--a', '9.5', '--b', '0'], deps({ universityOf }))).toBe(0);
      expect(await ruleOf(campus)).toEqual({ kind: 'linear', a: 9.5, b: 0 });
      expect(await runOpsCli(['cgpa-rule', 'set', '--campus', campus, '--a', '10', '--b', '0', '--force-unverified'], deps({ universityOf }))).toBe(0);
      expect(await ruleOf(campus)).toEqual({ kind: 'linear', a: 10, b: 0 });
    });

    it('--clear is never refused', async () => {
      const campus = await campusNamed('Test Institute affiliated to VTU');
      expect(await runOpsCli(['cgpa-rule', 'set', '--campus', campus, '--clear'], deps({ universityOf }))).toBe(0);
    });

    it('campus create refuses a rule on such a university the same way', async () => {
      const name = `Create VTU college ${randomUUID().slice(0, 6)}`;
      expect(await runOpsCli(['campus', 'create', '--name', name, '--domain', uniqueDomain(), '--cgpa-a', '10', '--cgpa-b', '0'], deps({ universityOf }))).toBe(1);
      expect((await c.query('SELECT 1 FROM campuses WHERE name = $1', [name])).rowCount).toBe(0);
    });
  });

  it('refuses an unknown campus', async () => {
    const n0 = await auditCount();
    expect(await runOpsCli(['cgpa-rule', 'set', '--campus', randomUUID(), '--a', '10', '--b', '0'], deps())).not.toBe(0);
    expect(await auditCount()).toBe(n0);
  });
});

describe('owner invite', () => {
  it('issues an unclaimed owner seat for a keyed hash of the address; the audit row holds the member id, never the address', async () => {
    const campus = await newCampus();
    const email = `principal-${randomUUID().slice(0, 6)}@example.test`;
    const d = deps();
    expect(await runOpsCli(['owner-invite', '--campus', campus, '--email', email.toUpperCase()], d)).toBe(0);
    const seat = (await c.query('SELECT id, role, user_id, email_hmac, expires_at > now() AS live FROM tpo_members WHERE campus_id = $1', [campus])).rows[0];
    expect(seat).toMatchObject({ role: 'owner', user_id: null, email_hmac: fakeHash(`mail:${email}`), live: true });
    const a = (await audit('owner_invite')).at(-1)!;
    expect(a).toMatchObject({ target: campus, actor: 'ops-tester' });
    expect(a.detail.memberId).toBe(seat.id);
    expect(JSON.stringify(a)).not.toContain(email);
    expect(JSON.stringify(a)).not.toContain(seat.email_hmac);
    expect(d.lines.join('\n')).not.toContain(email); // nothing echoes the address
  });

  it('the invitee, signed in with the verified address, claims the owner seat through tpo_claim_invites', async () => {
    const campus = await newCampus();
    const email = `owner-${randomUUID().slice(0, 6)}@example.test`;
    expect(await runOpsCli(['owner-invite', '--campus', campus, '--email', email], deps())).toBe(0);
    const u = await mkUser(c, email);
    await c.query('BEGIN');
    await c.query('SET LOCAL ROLE hirelane_app');
    await c.query("SELECT set_config('hirelane.user_id', $1, true)", [u.id]);
    const n = (await c.query('SELECT tpo_claim_invites($1) AS n', [fakeHash(`mail:${email}`)])).rows[0].n;
    const me = (await c.query('SELECT tpo_memberships() AS m')).rows[0].m;
    await c.query('COMMIT');
    expect(n).toBe(1);
    expect(me).toMatchObject([{ campusId: campus, role: 'owner' }]);
  });

  it('re-issues an expired unclaimed invite, refuses a live duplicate and a claimed seat, and refuses a bad address or campus', async () => {
    const campus = await newCampus();
    const email = `again-${randomUUID().slice(0, 6)}@example.test`;
    expect(await runOpsCli(['owner-invite', '--campus', campus, '--email', email], deps())).toBe(0);
    expect(await runOpsCli(['owner-invite', '--campus', campus, '--email', email], deps())).not.toBe(0); // live duplicate
    await c.query("UPDATE tpo_members SET expires_at = now() - interval '1 day' WHERE campus_id = $1", [campus]);
    const n0 = await auditCount();
    expect(await runOpsCli(['owner-invite', '--campus', campus, '--email', email], deps())).toBe(0);
    expect((await c.query('SELECT count(*)::int AS n, bool_and(expires_at > now()) AS live FROM tpo_members WHERE campus_id = $1', [campus])).rows[0]).toEqual({ n: 1, live: true });
    expect(await auditCount()).toBe(n0 + 1);
    const u = await mkUser(c, email);
    await c.query("UPDATE tpo_members SET user_id = $2, claimed_at = now() WHERE campus_id = $1", [campus, u.id]);
    expect(await runOpsCli(['owner-invite', '--campus', campus, '--email', email], deps())).not.toBe(0); // already a member
    expect(await runOpsCli(['owner-invite', '--campus', campus, '--email', 'nope'], deps())).not.toBe(0);
    expect(await runOpsCli(['owner-invite', '--campus', randomUUID(), '--email', 'a@b.test'], deps())).not.toBe(0);
    expect(await auditCount()).toBe(n0 + 1);
  });
});

describe('platform switch', () => {
  it('turns a platform off and on, with a reason, one audit row each; the worker reads exactly this row', async () => {
    const n0 = await auditCount();
    expect(await runOpsCli(['switch', 'set', '--platform', 'lever', '--off', '--reason', 'employer asked us to stop'], deps())).toBe(0);
    expect((await c.query("SELECT enabled, reason FROM platform_switches WHERE platform = 'lever'")).rows[0]).toEqual({ enabled: false, reason: 'employer asked us to stop' });
    expect((await c.query("SELECT enabled FROM platform_switches WHERE platform = 'greenhouse'")).rows[0].enabled).toBe(true); // others untouched
    expect(await runOpsCli(['switch', 'set', '--platform', 'lever', '--on'], deps())).toBe(0);
    expect((await c.query("SELECT enabled, reason FROM platform_switches WHERE platform = 'lever'")).rows[0]).toEqual({ enabled: true, reason: null });
    const rows = (await audit('platform_switch')).slice(-2);
    expect(await auditCount()).toBe(n0 + 2);
    expect(rows.map((r) => [r.target, r.detail.enabled, r.detail.previous])).toEqual([['lever', false, true], ['lever', true, false]]);
    expect(rows[0]!.detail.reason).toBe('employer asked us to stop');
  });

  it('refuses an unknown platform, a missing on/off, both, an over-long reason, and a missing switch row (it never invents one)', async () => {
    const n0 = await auditCount();
    for (const argv of [
      ['switch', 'set', '--platform', 'workday', '--off'],
      ['switch', 'set', '--platform', 'lever'],
      ['switch', 'set', '--platform', 'lever', '--on', '--off'],
      ['switch', 'set', '--platform', 'lever', '--off', '--reason', 'x'.repeat(301)],
    ]) expect(await runOpsCli(argv, deps()), argv.join(' ')).not.toBe(0);
    await c.query("DELETE FROM platform_switches WHERE platform = 'ashby'");
    expect(await runOpsCli(['switch', 'set', '--platform', 'ashby', '--on'], deps())).not.toBe(0);
    expect((await c.query("SELECT 1 FROM platform_switches WHERE platform = 'ashby'")).rowCount).toBe(0);
    await c.query("INSERT INTO platform_switches (platform) VALUES ('ashby')");
    expect(await auditCount()).toBe(n0);
  });
});

describe('the audit trail and the command line', () => {
  it('a failure in the audit insert rolls the change back (the change and its record are one transaction)', async () => {
    const campus = await newCampus();
    await c.query('ALTER TABLE ops_audit RENAME TO ops_audit_x');
    try {
      expect(await runOpsCli(['cgpa-rule', 'set', '--campus', campus, '--a', '10', '--b', '0'], deps())).not.toBe(0);
    } finally {
      await c.query('ALTER TABLE ops_audit_x RENAME TO ops_audit');
    }
    expect((await c.query('SELECT cgpa_rule FROM campuses WHERE id = $1', [campus])).rows[0].cgpa_rule).toBeNull();
  });

  it('the actor is recorded on every row, and an empty actor is refused', async () => {
    const campus = await newCampus(deps({ actor: 'alice' }));
    expect((await audit('campus_create')).at(-1)!.actor).toBe('alice');
    const n0 = await auditCount();
    expect(await runOpsCli(['cgpa-rule', 'set', '--campus', campus, '--a', '10', '--b', '0'], deps({ actor: '  ' }))).not.toBe(0);
    expect(await auditCount()).toBe(n0);
  });

  it('prints usage for no command, an unknown command, and unknown flags', async () => {
    for (const argv of [[], ['frobnicate'], ['campus'], ['campus', 'create', '--wat', '1'], ['--help']]) {
      const d = deps();
      const code = await runOpsCli(argv, d);
      expect(d.lines.join('\n')).toMatch(/usage/i);
      expect(code === 0).toBe(argv[0] === '--help');
    }
  });

  it('the app role cannot read or write the audit table', async () => {
    const u = await mkUser(c);
    for (const sql of ['SELECT 1 FROM ops_audit', "INSERT INTO ops_audit (actor, command) VALUES ('x', 'campus_create')"]) {
      await c.query('BEGIN');
      await c.query('SET LOCAL ROLE hirelane_app');
      await c.query("SELECT set_config('hirelane.user_id', $1, true)", [u.id]);
      let code: string | undefined;
      try {
        await c.query(sql);
      } catch (e) {
        code = (e as { code?: string }).code;
      }
      await c.query('ROLLBACK');
      expect(code, sql).toBe('42501');
    }
  });

  it('the audit table accepts only the known commands', async () => {
    await expect(c.query("INSERT INTO ops_audit (actor, command) VALUES ('x', 'drop_everything')")).rejects.toMatchObject({ code: '23514' });
  });
});
