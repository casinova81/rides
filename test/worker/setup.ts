import { applyD1Migrations, env } from 'cloudflare:test';

// Apply migrations/0001_init.sql to the simulated D1 before the worker tests run.
// TEST_MIGRATIONS is injected by vitest-pool-workers from the migrations dir.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
