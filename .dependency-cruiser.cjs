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
      name: 'services-deps',
      comment: 'services may import db, engine, vault and agent; never apps or workers (and not ingest)',
      severity: 'error',
      from: { path: pkg('services') + 'src/' },
      to: { path: ['^packages/(?!services|db|engine|vault|agent)', '^apps/', '^workers/'] },
    },
    {
      name: 'api-v1-thin',
      comment:
        'apps/web/app/api/v1/** is a thin adapter: it may import @hirelane/services, apps/web/lib/auth and apps/web/lib/http (plus npm, node and its own files); never @hirelane/db or any other workspace package or web module',
      severity: 'error',
      from: { path: '^apps/web/app/api/v1/' },
      to: {
        path: [
          '^packages/(?!services/)',
          '^workers/',
          '^apps/web/(?!lib/(auth|http)(/|\\.)|app/api/v1/)',
          // The web app's "@/" alias is not resolved by depcruise (no tsConfig), so it is matched by its spelling.
          '^@/(?!lib/(auth|http)(/|\\.|$))',
        ],
      },
    },
    {
      name: 'actions-thin',
      comment:
        'signed-in server actions (apps/web/app/(app)/**/actions.ts) reach data through @hirelane/services or apps/web/lib only: never @hirelane/db, engine, agent, vault or workers directly (Amendment B section 11)',
      severity: 'error',
      from: { path: '^apps/web/app/\\(app\\)/.*actions\\.ts$' },
      to: { path: ['^packages/(?!services/)', '^workers/'] },
    },
    {
      name: 'extractors-worker-only',
      comment: 'unpdf, pdfjs-dist, fflate, pdfkit and fontkit are heavy parsers/renderers: only workers/runner may import them',
      severity: 'error',
      from: { pathNot: '^workers/runner/' },
      // Matches both the pnpm-resolved path (.../node_modules/unpdf/...) and the bare name when the package is not installed here.
      to: { path: '(^|/)(node_modules/)?(unpdf|pdfjs-dist|fflate|pdfkit|fontkit)(/|$)' },
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
      comment:
        'only packages/agent/src/submit/ may import the submit module (architecture.md 2.2). One written exception: the worker tasks workers/runner/src/tasks/apply-*.ts, which run the executor (apply pipeline, owner decision 2026-10-29)',
      severity: 'error',
      from: { pathNot: ['^packages/agent/src/submit/', '^workers/runner/src/tasks/apply-[^/]*\\.ts$'] },
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
