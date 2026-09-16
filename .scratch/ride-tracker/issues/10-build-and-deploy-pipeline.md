# Build & deploy pipeline

Type: grilling
Status: resolved

## Question

How does the site get built and deployed? The architecture research settled that uploads never trigger builds (dynamic pages read D1/R2 at request time), so this is purely about shipping code changes.

Decide with Carsten:

- **Deploy path**: git-connected Workers Builds (free: 3,000 build min/month, 1 concurrent, 20-min timeout) vs. GitHub Actions running `wrangler deploy` vs. plain local `wrangler deploy`. Note: the working directory isn't a git repo yet — where does the code live?
- **Preview deployments**: are per-branch preview URLs wanted, and what does each deploy path offer?
- **D1 schema migrations**: how migrations run on deploy (`wrangler d1 migrations` in CI vs. manually).
- **Secrets/config**: where `wrangler.jsonc` bindings and any auth secrets are managed across local dev and production.

## Answer

**Update (2026-09-16, [GitHub issue #2](https://github.com/casinova81/rides/issues/2)):**
The repository is now hosted on GitHub. The local-only hosting/deployment and
no-CI decisions below are superseded: GitHub Actions typechecks, tests, and builds
pull requests, then automatically deploys successful pushes to `main` using the
existing `npm run deploy` pipeline. Scoped Cloudflare credentials live in Actions
secrets; production runs are serialized. No preview deployments, storage changes,
or changes to the Access gate. Local deployment remains an emergency fallback.
See the [deployment setup](../../../README.md#github-actions-deployment).

### Original decision (superseded where noted above)

Resolved with Carsten (grilling, 2026-07-16):

- **Code hosting**: local git repo at `~/Sites/rides` only — no remote. Code-loss risk consciously accepted (a dead laptop loses only source; ride data is safe in R2/D1, and the effort's specs allow a rebuild). GitHub/GitLab and any "dumb backup" remote were offered and declined.
- **Deploy path**: plain local `wrangler deploy` from this machine. Workers Builds and GitHub Actions are ruled out by the no-remote decision. Wrangler authenticates via one-time `wrangler login` (OAuth) — no API tokens stored anywhere.
- **Preview deployments**: none. Local `astro dev` is the pre-production check; deploys go straight to production. `wrangler rollback` is the recovery path for a bad deploy. (`wrangler versions upload` preview URLs were offered and declined.)
- **D1 migrations**: bundled into the deploy script so they can't be forgotten. `wrangler d1 migrations apply <db> --remote` is idempotent (wrangler tracks applied migrations per database), so it's a no-op when nothing is new.
- **Deploy script**: single `npm run deploy` = `astro check` (typecheck gate — the only gate; no CI, no test gate) → `wrangler d1 migrations apply --remote` → `astro build` → `wrangler deploy`.
- **Secrets/config**: there are no runtime secrets. Cloudflare Access handles all auth at the edge (per the auth ticket: zero auth code in the project), and `wrangler.jsonc` carries only non-sensitive binding IDs (D1 database ID, R2 bucket name) — it is committed to the repo.
- **Local dev data**: Miniflare-simulated local D1/R2 bindings (the Astro Cloudflare adapter's default via `getPlatformProxy`), seeded by uploading GPX files through the local app. Dev code can never touch production data; works offline. Remote-binding dev was offered and declined.
