// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

// One Astro project deployed as a single Cloudflare Worker (issue 02).
// Static by default; dynamic pages opt out with `export const prerender = false`
// and read the DB/GPX_BUCKET bindings per request, so new rides never need a rebuild.
export default defineConfig({
  output: 'static',
  adapter: cloudflare({
    platformProxy: { enabled: true, configPath: 'wrangler.jsonc' },
    imageService: 'compile',
  }),
});
