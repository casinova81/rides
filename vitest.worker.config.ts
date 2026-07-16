import path from 'node:path';
import { defineWorkersProject, readD1Migrations } from '@cloudflare/vitest-pool-workers/config';

// Worker-side tests run inside workerd with the same D1/R2 bindings local dev
// uses (issue 02 testing decisions). Bindings are declared directly on miniflare
// rather than via the Astro `wrangler.jsonc` on purpose: that config's `main`
// points at the built `dist/_worker.js` (the whole Astro app + WASM), which the
// test runner must not load — these tests import the pure lib modules and drive
// the bindings directly. Migrations are read from ./migrations and applied per
// run in test/worker/setup.ts.
export default defineWorkersProject(async () => {
  const migrations = await readD1Migrations(path.join(__dirname, 'migrations'));
  return {
    test: {
      name: 'worker',
      include: ['test/worker/**/*.test.ts'],
      setupFiles: ['./test/worker/setup.ts'],
      poolOptions: {
        workers: {
          singleWorker: true,
          // Storage persists across tests; every suite clears rides + bucket in
          // beforeEach, and isolated storage's sqlite sidecar files trip its
          // per-test teardown on this platform.
          isolatedStorage: false,
          miniflare: {
            compatibilityDate: '2026-07-16',
            compatibilityFlags: ['nodejs_compat'],
            d1Databases: { DB: 'test-db' },
            r2Buckets: { GPX_BUCKET: 'test-bucket' },
            bindings: { TEST_MIGRATIONS: migrations },
          },
        },
      },
    },
  };
});
