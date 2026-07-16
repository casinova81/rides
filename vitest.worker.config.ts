import path from 'node:path';
import { defineWorkersProject, readD1Migrations } from '@cloudflare/vitest-pool-workers/config';

// Worker HTTP tests run inside workerd with the same D1/R2 bindings local dev
// uses (issue 02 testing decisions). Migrations are read from ./migrations and
// applied per test file via `applyD1Migrations` in test/worker/setup.ts.
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
          wrangler: { configPath: './wrangler.jsonc' },
          miniflare: {
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
