import { defineConfig } from 'vitest/config';

// Two test seams from the PRD run in different environments:
//  - `unit`   : the pure domain core (derivation pipeline, Track, playback core) — plain node.
//  - `worker` : the Worker HTTP surface against simulated Miniflare D1/R2 bindings.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
          environment: 'node',
        },
      },
      './vitest.worker.config.ts',
    ],
  },
});
