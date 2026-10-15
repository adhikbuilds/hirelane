/** Seed stub. Later phases add companies, boards and demo users. The facet view is rebuilt last so lists see fresh counts. */
import { close, withAdmin } from './client.js';
import { refreshJobFacets } from './enrich/persist.js';

await withAdmin((c) => refreshJobFacets(c));
console.log('seed: job_facets refreshed (no other seed data yet).');
await close();
