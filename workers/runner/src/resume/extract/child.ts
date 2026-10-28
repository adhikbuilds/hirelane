/**
 * Entry point of the extraction child process (see thread.ts). Node loads this file natively
 * (type stripping), which does not resolve extensionless imports, so a resolve hook retries `.ts`
 * before the real module is imported. Keep static imports out of this file.
 */
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (err) {
      if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
        return nextResolve(`${specifier}.ts`, context);
      }
      throw err;
    }
  },
});

process.once('message', async (bytes: unknown) => {
  let result: unknown;
  try {
    const entry = './index.ts'; // variable specifier: TS would otherwise demand allowImportingTsExtensions
    const mod = (await import(entry)) as { extractResume: (b: Uint8Array) => Promise<unknown> };
    result = await mod.extractResume(bytes as Uint8Array);
  } catch {
    result = { rejected: 'parse_error' };
  }
  process.send!(result, () => process.exit(0));
});
