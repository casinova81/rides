# Cloudflare architecture: storage, parsing, and Astro deployment

Type: research
Status: resolved

## Question

How should the Cloudflare pieces fit together for upload → storage → derived stats → pages?

Pin down, with sources (current free-tier limits included):

- **Storage**: where raw GPX lives (R2) and where derived per-ride JSON + aggregate stats live (R2 vs. KV vs. D1) — read patterns for ride pages, dashboard, records, heatmap.
- **Parsing/compute**: where GPX is parsed and stats computed — Worker at upload time vs. client-side vs. build step. Worker CPU limits vs. a ~600KB/4k-point GPX parse.
- **Astro on Cloudflare**: static pages vs. SSR via the Cloudflare adapter; how an upload endpoint coexists with Astro (Pages Functions vs. separate Worker); how new rides appear without a rebuild (or whether a rebuild-on-upload is acceptable).
- **Auth surface**: what Cloudflare Access vs. a basic-auth Worker each protect (facts only — the decision is the auth ticket).

Deliver a markdown summary as a linked asset with a recommended architecture diagram.

## Answer

Full research with sources, free-tier limits table, and architecture diagram: [Cloudflare architecture research](../assets/02-cloudflare-architecture-research.md) (fetched 2026-07-16).

**Recommended architecture — single Astro project deployed as a single Cloudflare Worker:**

- **Workers, not Pages — forced, not chosen.** The current `@astrojs/cloudflare` adapter has removed Cloudflare Pages support entirely, so Pages Functions and Pages Deploy Hooks are off the table. Since Astro 6, bindings come via `import { env } from 'cloudflare:workers'` (`Astro.locals.runtime` is gone) and `astro dev` runs on real workerd.
- **Storage split:** raw GPX → **R2** (private by default; only reachable through the Worker binding; 10 GB free ≈ ~17,000 rides). All derived data — per-ride stats, simplified polylines, aggregates, records, heatmap data — → **D1**. KV disqualified itself: writes take "up to 60 seconds or more" to be globally visible and the docs disclaim read-modify-write, which is exactly the upload-then-view-dashboard loop; records/dashboard are SQL queries, not key lookups. D1 free limits (5M row-reads/day, 100k writes/day) are ~4 orders of magnitude beyond one-user needs.
- **Parsing: client-side in the browser before upload.** Free-plan Workers still cap CPU at **10 ms/request**, and a 600 KB GPX parse is an estimated 5–40 ms — marginal-to-over. The browser has DOMParser (Workers don't); with one trusted user there's no integrity concern. Upload POST carries raw GPX (→R2) + computed stats/polyline JSON (→D1); the Worker only validates and stores. Build-time computation rejected (defeats no-rebuild).
- **Astro shape:** default `output: 'static'`; ride detail, dashboard, records, and heatmap pages set `export const prerender = false` and read D1/R2 per request — **new rides appear with zero rebuilds**. The upload endpoint is an Astro API route (`src/pages/api/upload.ts`) compiled into the same Worker; a separate Worker buys nothing. Static asset requests are free/unlimited and don't count against the 100k/day Worker request cap.
- **Auth facts (decision → auth ticket):** Cloudflare Access fronts *all* requests (assets + API) at the edge, one-click enable for `workers.dev`, free ≤50 users — but Cloudflare's docs say to also validate the Access JWT in-Worker. Worker-internal basic auth only sees requests that reach the script — static assets bypass it unless `run_worker_first: true` (fine at one-user volume). R2 stays private either way.
