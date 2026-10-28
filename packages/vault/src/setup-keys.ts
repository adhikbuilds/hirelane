/** pnpm setup:keys : prints a fresh master key to stdout. It never writes a file. */
import { generateMasterKey, MASTER_KEY_ENV } from './keys.js';

console.error('Add this line to .env.local (gitignored). Do not commit it, and do not rotate it without re-wrapping stored data.');
console.log(`${MASTER_KEY_ENV}=${generateMasterKey()}`);
