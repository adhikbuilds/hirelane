/** `pnpm demo:seed`: seeds the synthetic demo campus into the LOCAL database. Needs HIRELANE_DEMO=1. Prints the join code once. */
import { close, withAdmin } from '../packages/db/src/index';
import { requireDatabaseUrl } from '../packages/db/src/env';
import { EnvKeyProvider } from '../packages/vault/src/index';
import { campusCodeHmac, generateCampusCode, mailboxHmac, normalizeMailbox } from '../packages/services/src/campus/codes';
import { assertDemoMayRun, seedDemo, DEMO_OWNER_EMAIL } from './demo-seed-lib';

async function main(): Promise<void> {
  assertDemoMayRun(requireDatabaseUrl(), process.env);
  const keys = new EnvKeyProvider(process.env);
  try {
    const r = await seedDemo({
      run: (fn) => withAdmin((c) => fn(c as never)),
      mailboxHmac: async (e) => {
        const m = normalizeMailbox(e);
        return m ? mailboxHmac(keys, m) : null;
      },
      codeHmac: (code) => campusCodeHmac(keys, code),
      generateCode: () => generateCampusCode(),
      now: () => new Date(),
    });
    console.log(r.created ? `demo campus created. join code ${r.code}. owner seat (unclaimed): ${DEMO_OWNER_EMAIL}` : 'demo campus already present; nothing changed.');
  } finally {
    await close();
  }
}
main().catch((e: unknown) => {
  console.error(`error: ${e instanceof Error ? e.message : 'unexpected failure'}`);
  process.exit(1);
});
