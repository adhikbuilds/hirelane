import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Component tests opt into jsdom with `// @vitest-environment jsdom`; everything else stays on node.
  oxc: { jsx: { runtime: "automatic" } },
  // Mirrors tsconfig's "@/*" so shadcn components (which import "@/lib/utils") resolve under test.
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: { include: ["tests/**/*.test.{ts,tsx}"], environment: "node", setupFiles: ["./tests/helpers/setup-dom.ts"] },
});
