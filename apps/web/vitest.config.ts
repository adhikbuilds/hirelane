import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Component tests opt into jsdom with `// @vitest-environment jsdom`; everything else stays on node.
  oxc: { jsx: { runtime: "automatic" } },
  // Mirrors tsconfig's "@/*" so shadcn components (which import "@/lib/utils") resolve under test.
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  // Each DB test file drops and re-creates its own schema; with every core running at once the shared Postgres lock table
  // ("out of shared memory", max_locks_per_transaction = 64) runs out. Four workers stays well under it.
  test: { maxWorkers: 4, include: ["tests/**/*.test.{ts,tsx}"], environment: "node", setupFiles: ["./tests/helpers/setup-dom.ts"] },
});
