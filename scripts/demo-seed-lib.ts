/**
 * The demo seed: one synthetic campus ("sample"), 24 verified students, drives, outcomes and an UNCLAIMED owner seat.
 * Synthetic data only (every address ends .example.test), 0 LLM calls, no network, no mail. Idempotent: a second run changes nothing.
 * Refused unless HIRELANE_DEMO=1, the database is this machine and NODE_ENV is not production.
 */
import { isLocalUrl } from '../packages/db/src/env';

type Env = Record<string, string | undefined>;
interface Q {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }>;
}
export interface DemoDeps {
  run: <T>(fn: (q: Q) => Promise<T>) => Promise<T>;
  mailboxHmac: (email: string) => Promise<string | null>;
  codeHmac: (code: string) => Promise<string>;
  generateCode: () => string;
  now: () => Date;
}

export const DEMO_CAMPUS_NAME = 'Demo Institute of Technology (sample)';
export const DEMO_DOMAIN = 'demo-college.example.test';
export const DEMO_OWNER_EMAIL = `placement@${DEMO_DOMAIN}`;
export const DEMO_STUDENT_EMAIL = `student01@${DEMO_DOMAIN}`;
const STUDENTS = 24;

export function assertDemoMayRun(databaseUrl: string, env: Env): void {
  if (env['HIRELANE_DEMO'] !== '1') throw new Error('The demo seed needs HIRELANE_DEMO=1.');
  if (env['NODE_ENV'] === 'production') throw new Error('The demo seed never runs with NODE_ENV=production.');
  if (!isLocalUrl(databaseUrl)) throw new Error('The demo seed only runs against a local database.');
}

const crit = (c: Record<string, unknown>) => ({ ...c, evidence: [] });

export async function seedDemo(d: DemoDeps): Promise<{ created: boolean; code: string | null; campusId: string }> {
  return d.run(async (q) => {
    await q.query('BEGIN');
    try {
      const have = (await q.query('SELECT id FROM campuses WHERE name = $1', [DEMO_CAMPUS_NAME])).rows[0];
      if (have) {
        await q.query('COMMIT');
        return { created: false, code: null, campusId: String(have['id']) };
      }
      const now = d.now();
      const code = d.generateCode();
      const campusId = String(
        (await q.query('INSERT INTO campuses (name, code_hmac, cgpa_rule) VALUES ($1, $2, $3::jsonb) RETURNING id', [DEMO_CAMPUS_NAME, await d.codeHmac(code), JSON.stringify({ kind: 'linear', a: 9.5, b: 0 })])).rows[0]!['id'],
      );
      await q.query('INSERT INTO campus_domains (campus_id, domain) VALUES ($1, $2)', [campusId, DEMO_DOMAIN]);
      const cohortId = String(
        (await q.query('INSERT INTO cohorts (campus_id, passout_year, programme) VALUES ($1, $2, $3) RETURNING id', [campusId, now.getUTCFullYear() + 0, 'B.E. Computer Science'])).rows[0]!['id'],
      );
      const owner = await d.mailboxHmac(DEMO_OWNER_EMAIL);
      if (!owner) throw new Error('demo owner address was rejected');
      await q.query(`INSERT INTO tpo_members (campus_id, email_hmac, role) VALUES ($1, $2, 'owner')`, [campusId, owner]);

      // The officer persona needs a real users row to sign in as (the tpo seat above is only an HMAC).
      const officer = String((await q.query(`INSERT INTO users (email, email_verified_at, display_name) VALUES ($1, now(), 'Sample Placement Officer') RETURNING id`, [DEMO_OWNER_EMAIL])).rows[0]!['id']);
      for (const kind of ['age_18_plus', 'terms', 'privacy']) {
        await q.query(`INSERT INTO consents (user_id, kind, granted, doc_version) VALUES ($1, $2, true, 'demo')`, [officer, kind]);
      }

      const users: string[] = [];
      for (let i = 1; i <= STUDENTS; i++) {
        const n = String(i).padStart(2, '0');
        const email = `student${n}@${DEMO_DOMAIN}`;
        const u = String((await q.query(`INSERT INTO users (email, email_verified_at, display_name) VALUES ($1, now(), $2) RETURNING id`, [email, `Sample Student ${n}`])).rows[0]!['id']);
        users.push(u);
        for (const kind of ['age_18_plus', 'terms', 'privacy', 'campus_share']) {
          await q.query(`INSERT INTO consents (user_id, kind, granted, doc_version) VALUES ($1, $2, true, 'demo')`, [u, kind]);
        }
        const hmac = await d.mailboxHmac(email);
        await q.query(
          `INSERT INTO cohort_members (user_id, campus_id, cohort_id, share_level, verified_via, verified_at, email_hmac, placed) VALUES ($1, $2, $3, $4, 'email', now(), $5, $6)`,
          [u, campusId, cohortId, i <= 12 ? 'outcomes' : 'aggregate', hmac, i === 13 || i === 14],
        );
        // 18 confirmed profiles with a spread (pass, fail, unknown by backlog/percentage); 6 students have none (unknown).
        if (i <= 18) {
          const pct = 52 + ((i * 7) % 34);
          await q.query(
            `INSERT INTO eligibility_profiles (user_id, confirmed_at, pct_10, pct_secondary, secondary_kind, degree, branch_code, grad_scale, grad_score, grad_pct_equiv, grad_conversion, grad_is_final, active_backlogs, gap_years, passout_year)
             VALUES ($1, now(), $2, $3, '12th', 'B.E.', 'CSE', 100, $4, $4, 'direct', true, $5, 0, $6)`,
            [u, 70 + (i % 20), 65 + (i % 25), pct, i % 6 === 0 ? 1 : 0, now.getUTCFullYear()],
          );
        }
      }

      const drives = [
        { title: 'Sample Analytics Co: graduate trainee (sample)', notice: 'Sample Analytics Co is hiring graduate trainees. 60% throughout, no active backlogs, CSE and ECE.', criteria: [crit({ type: 'min_score', levels: ['ug'], pct: 60, throughout: false }), crit({ type: 'no_active_backlogs' })] },
        { title: 'Example Systems: software engineer (sample)', notice: 'Example Systems campus drive. Minimum 70% in graduation. Sample notice for the demo.', criteria: [crit({ type: 'min_score', levels: ['ug'], pct: 70, throughout: false })] },
      ];
      for (const dr of drives) {
        await q.query(`INSERT INTO drives (campus_id, cohort_id, title, notice_text, criteria, status) VALUES ($1, $2, $3, $4, $5::jsonb, 'published')`, [campusId, cohortId, dr.title, dr.notice, JSON.stringify(dr.criteria)]);
      }

      const out = async (i: number, kind: string, employer: string, role: string | null, pkg: number | null, verified: boolean) => {
        await q.query(
          `INSERT INTO outcomes (user_id, campus_id, cohort_id, kind, employer, role_title, package_lpa, verification, verified_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, ${verified ? 'now()' : 'NULL'})`,
          [users[i - 1], campusId, cohortId, kind, employer, role, pkg, verified ? 'tpo_verified' : 'student_reported'],
        );
      };
      await out(13, 'offer', 'Sample Analytics Co', 'Graduate Trainee', 4.5, true);
      await out(14, 'offer', 'Example Systems', 'Software Engineer', 6.0, true);
      await out(1, 'offer', 'Demo Retail Labs', 'Associate Engineer', 5.2, false);
      await out(2, 'offer', 'Placeholder Fintech', 'Analyst', 7.5, false);
      await out(3, 'higher_studies', 'Sample University (sample)', 'M.Tech Data Science', null, false);
      await out(4, 'interview', 'Example Systems', null, null, false);
      await out(5, 'interview', 'Demo Retail Labs', null, null, false);
      await out(6, 'interview', 'Sample Analytics Co', null, null, false);
      await q.query('COMMIT');
      return { created: true, code, campusId };
    } catch (e) {
      await q.query('ROLLBACK').catch(() => undefined);
      throw e;
    }
  });
}
