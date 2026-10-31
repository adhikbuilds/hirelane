import { userInfo } from 'node:os';
import { describe, expect, it } from 'vitest';
import { EnvKeyProvider, generateMasterKey } from '../../packages/vault/src/index';
import { campusCodeHmac, mailboxHmac, normalizeCampusCode } from '../../packages/services/src/campus/codes';
import { assertMayRun, buildOpsDeps, operatorName } from '../ops/deps';

const noRun = async () => {
  throw new Error('not used');
};
const env = (over: Record<string, string> = {}) => ({ HIRELANE_MASTER_KEY: generateMasterKey(), ...over });

describe('the hashes are the ones the app uses (so a seat or a code made here works in the app)', () => {
  it('codeHmac equals the services campusCodeHmac, and generateCode makes a code the join screen accepts', async () => {
    const e = env();
    const d = buildOpsDeps({ env: e, run: noRun, log: () => undefined });
    const code = d.generateCode();
    expect(normalizeCampusCode(code)).toBe(code);
    expect(await d.codeHmac(code)).toBe(await campusCodeHmac(new EnvKeyProvider(e), code));
    expect(d.generateCode()).not.toBe(code);
  });

  it('mailboxHmac normalises the address like the app and answers null for text that is not an address', async () => {
    const e = env();
    const d = buildOpsDeps({ env: e, run: noRun, log: () => undefined });
    expect(await d.mailboxHmac('  Dean@College.Example.Test ')).toBe(await mailboxHmac(new EnvKeyProvider(e), 'dean@college.example.test'));
    expect(await d.mailboxHmac('not an address')).toBeNull();
  });

  it('the master key is read only when a hash is needed, so domain and switch commands run without one', async () => {
    const d = buildOpsDeps({ env: {}, run: noRun, log: () => undefined });
    await expect(d.codeHmac('ABCD2345')).rejects.toThrow(/HIRELANE_MASTER_KEY/);
  });
});

describe('who is running it, and where', () => {
  it('uses HIRELANE_OPS_ACTOR, else the login name', () => {
    expect(operatorName({ HIRELANE_OPS_ACTOR: ' alice ' })).toBe('alice');
    expect(operatorName({})).toBe(userInfo().username);
  });
  it('runs on a local database; a remote one needs HIRELANE_OPS_ALLOW_REMOTE=1', () => {
    expect(() => assertMayRun('postgres://u:p@localhost:5433/hirelane', {})).not.toThrow();
    expect(() => assertMayRun('postgres://u:p@db.prod.example.com:5432/hirelane', {})).toThrow(/HIRELANE_OPS_ALLOW_REMOTE/);
    expect(() => assertMayRun('postgres://u:p@db.prod.example.com:5432/hirelane', { HIRELANE_OPS_ALLOW_REMOTE: '1' })).not.toThrow();
    expect(() => assertMayRun('postgres://u:p@db.prod.example.com:5432/hirelane', { HIRELANE_OPS_ALLOW_REMOTE: 'yes' })).toThrow();
  });
});
