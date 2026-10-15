import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text-summary', 'text'],
      // Per-file gates only for the files this lane owns; other lanes gate their own files.
      thresholds: {
        'src/salary.ts': { lines: 90 },
        'src/requirements.ts': { lines: 90 },
        'src/dedup.ts': { lines: 90 },
      },
    },
  },
});
