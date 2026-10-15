import { defineConfig } from "vitest/config";

// Root workspace: one project per package, worker and the scripts folder.
export default defineConfig({
  test: {
    projects: ["packages/*", "workers/*", "scripts"],
  },
});
