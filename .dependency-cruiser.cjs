/** Package boundaries from PLAN.md 5.2. */
const pkg = (name) => `^packages/${name}/`;
module.exports = {
  forbidden: [
    {
      name: 'engine-is-pure',
      comment: 'engine has zero runtime dependencies on other packages or I/O libraries',
      severity: 'error',
      from: { path: pkg('engine') + 'src/' },
      to: { path: ['^packages/(?!engine)', '^apps/', '^workers/', '^node_modules/(pg|drizzle-orm|graphile-worker)'] },
    },
    {
      name: 'db-no-business-logic',
      comment: 'db may not import other workspace packages',
      severity: 'error',
      from: { path: pkg('db') + 'src/' },
      to: { path: ['^packages/(?!db)', '^apps/', '^workers/'] },
    },
    {
      name: 'ingest-only-db',
      comment: 'ingest may import db only (no enrichment, no LLM)',
      severity: 'error',
      from: { path: pkg('ingest') + 'src/' },
      to: { path: ['^packages/(?!ingest|db)', '^apps/', '^workers/'] },
    },
    {
      name: 'agent-engine-db',
      comment: 'agent may import engine and db only',
      severity: 'error',
      from: { path: pkg('agent') + 'src/' },
      to: { path: ['^packages/(?!agent|engine|db|vault)', '^apps/', '^workers/'] },
    },
    {
      name: 'web-boundaries',
      comment: 'web may import db, engine, agent; never ingest or workers',
      severity: 'error',
      from: { path: '^apps/web/' },
      to: { path: ['^packages/(ingest)/', '^workers/'] },
    },
    {
      name: 'vault-is-leaf',
      comment: 'vault imports no other workspace package, app or worker (envelope crypto stays a leaf)',
      severity: 'error',
      from: { path: pkg('vault') + 'src/' },
      to: { path: ['^packages/(?!vault)', '^apps/', '^workers/'] },
    },
    {
      name: 'nothing-imports-apps',
      comment: 'packages and workers never import apps',
      severity: 'error',
      from: { path: ['^packages/', '^workers/'] },
      to: { path: '^apps/' },
    },
    {
      name: 'submit-is-isolated',
      comment: 'only packages/agent/src/submit/ may import the submit module (architecture.md 2.2)',
      severity: 'error',
      from: { pathNot: '^packages/agent/src/submit/' },
      to: { path: '^packages/agent/src/submit/' },
    },
    {
      name: 'workers-not-imported',
      comment: 'nothing imports workers/runner',
      severity: 'error',
      from: { pathNot: '^workers/' },
      to: { path: '^workers/' },
    },
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: undefined,
    exclude: { path: ['/node_modules/', '/\\.next/', '/dist/'] },
  },
};
