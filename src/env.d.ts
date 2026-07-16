/// <reference types="astro/client" />

// Cloudflare bindings (issue 02 / provisioning issue 11). Locked names: DB, GPX_BUCKET.
type Env = {
  DB: import('@cloudflare/workers-types').D1Database;
  GPX_BUCKET: import('@cloudflare/workers-types').R2Bucket;
  ASSETS: import('@cloudflare/workers-types').Fetcher;
};

type Runtime = import('@astrojs/cloudflare').Runtime<Env>;

declare namespace App {
  interface Locals extends Runtime {}
}
