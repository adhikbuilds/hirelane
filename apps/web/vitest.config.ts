import { defineConfig } from "vitest/config";

export default defineConfig({
  // Component tests opt into jsdom with `// @vitest-environment jsdom`; everything else stays on node.
  oxc: { jsx: { runtime: "automatic" } },
  test: { include: ["tests/**/*.test.{ts,tsx}"], environment: "node", setupFiles: ["./tests/helpers/setup-dom.ts"] },
});
