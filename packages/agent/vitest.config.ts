import { defineConfig } from 'vitest/config';

export default defineConfig({
  // src/submit/**: the submit module may only be imported from inside its own folder (dependency-cruiser rule
  // submit-is-isolated), so its tests live there too.
  test: { include: ['test/**/*.test.ts', 'src/submit/**/*.test.ts'] },
});
