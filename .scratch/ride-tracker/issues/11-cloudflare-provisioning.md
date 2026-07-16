# Cloudflare provisioning checklist

Type: task
Status: resolved
Blocked by: 10-build-and-deploy-pipeline

## Question

Provision the Cloudflare resources so building can start. Nothing left to decide here — the architecture ([Cloudflare architecture](02-cloudflare-architecture.md)) and auth ([Authentication approach](05-auth-approach.md)) tickets fixed the shape:

- Cloudflare account (free plan) + `wrangler` login.
- The Worker (Astro build target) on its `workers.dev` subdomain.
- R2 bucket (raw GPX, private — no public access, no `r2.dev` URL).
- D1 database + initial schema from the locked data model.
- **Cloudflare Access**: one-click enable on the `workers.dev` domain; policy = one-time-PIN login, allow-list containing only Carsten's personal email (supplied at run time, not stored in the repo), session duration **1 month**. No in-Worker JWT validation.

Blocked by the build & deploy pipeline decision because the deploy path (git-connected Workers Builds vs. `wrangler deploy`) changes the provisioning steps.

The agent drives what it can via `wrangler` (AFK); dashboard-only steps (account creation, Access toggle, policy) become a precise checklist for Carsten (HITL). The answer records what was created — names, IDs, URLs — for later tickets.

## Answer

Provisioned 2026-07-16 (agent via `wrangler` + Carsten in the dashboard, per the [checklist](../assets/11-provisioning-checklist.md)). Everything the build effort needs:

- **Account**: carsten.guhl@googlemail.com, account ID `d1875800826da62900a2ec8badd831c4`, free plan; R2 enabled (payment method on file, €0 usage). `wrangler` authenticated on this machine via OAuth (`wrangler login`, credentials in `~/Library/Preferences/.wrangler/config/default.toml`).
- **`workers.dev` subdomain**: `rides` — which forced one naming change: the Worker is **`app`** (not `rides`; avoids `rides.rides.workers.dev`).
- **Worker**: `app` → **https://app.rides.workers.dev** — currently a provisioning stub; the Astro deploy replaces it in place (same name). Compatibility date 2026-07-16. Preview URLs (`*-app.rides.workers.dev`) **disabled** (no-previews decision in [Build & deploy pipeline](10-build-and-deploy-pipeline.md)).
- **R2 bucket**: `rides-gpx` (Standard class) — private: no `r2.dev`, no custom domain; reachable only via the Worker binding.
- **D1 database**: `rides-db`, ID `928b92ad-f12b-4a40-9647-341f5d63a6ad`, region WEUR. [Initial schema](../assets/11-d1-initial-schema.sql) applied remotely: `rides` + `ride_tracks` tables, unique index on `start`. The same file seeds the project's `migrations/0001_init.sql`.
- **Cloudflare Access** (per [Authentication approach](05-auth-approach.md)): Zero Trust team **`autumn-tooth-bc56`**, free plan. Production Worker URL set to **Restricted**, auto-creating the Access app for `app.rides.workers.dev` with policy "app - Production" (ID `5183a51a-051d-4edf-85f2-3e4211f897fd`): Allow, single Include rule **Emails = carsten.guhl@googlemail.com**; login = one-time PIN only; **session duration 1 month**; no in-Worker JWT validation (locked decision).
- **Verified**: Carsten completed the PIN login in a private window and reached the stub; unauthenticated `curl` gets 302 → `autumn-tooth-bc56.cloudflareaccess.com` login; the disabled preview host returns 404.

`wrangler.jsonc` bindings for the build (locked names `DB` / `GPX_BUCKET`):

```jsonc
{
  "name": "app",
  "d1_databases": [{ "binding": "DB", "database_name": "rides-db", "database_id": "928b92ad-f12b-4a40-9647-341f5d63a6ad" }],
  "r2_buckets": [{ "binding": "GPX_BUCKET", "bucket_name": "rides-gpx" }]
}
```

## Comments

**2026-07-16 (session 1)** — Preparation done; provisioning itself is blocked on HITL. `wrangler whoami` shows no authenticated Cloudflare account on this machine, and account creation + OAuth login are steps only Carsten can perform. Produced this session:

- [Provisioning checklist](../assets/11-provisioning-checklist.md) — locked resource names (Worker `rides`, R2 `rides-gpx`, D1 `rides-db`, bindings `GPX_BUCKET`/`DB`), the exact HITL steps (account, `workers.dev` subdomain, R2 enablement, `npx wrangler login`, Zero Trust onboarding, one-click Access + OTP policy + 1-month session), and the paste-able/AFK `wrangler` commands, including a stub-Worker deploy so Access can be enabled before the Astro app exists.
- [Initial D1 schema](../assets/11-d1-initial-schema.sql) — migration seed derived mechanically from the locked data model: `rides` table storing the contract JSON blobs + polyline (unique index on `start` enforces the re-upload-replaces rule), separate `ride_tracks` table so library/dashboard queries never read ~200 KB track rows; records not stored, recomputed from summaries.

**Next**: Carsten runs checklist Phase 1 (account + R2 enable + `wrangler login`), then re-invokes `/wayfinder` on this ticket — the agent runs Phase 2 via `wrangler`, Carsten finishes Phase 3 (Access), and the ticket resolves with the recorded names/IDs/URLs.

**2026-07-16 (session 2)** — Phases 1 + 2 complete; only the Access gate (Phase 3, HITL) remains.

Created and verified:

- **Account**: carsten.guhl@googlemail.com, account ID `d1875800826da62900a2ec8badd831c4`, free plan; R2 enabled (card on file). `wrangler login` OAuth done on this machine.
- **`workers.dev` subdomain**: `rides` → Worker name changed from `rides` to `app` (avoids `rides.rides.workers.dev`).
- **Worker**: `app`, stub deployed and verified live at <https://app.rides.workers.dev> (HTTP 200). The Astro build later replaces it in place.
- **R2 bucket**: `rides-gpx` (Standard class, private — no r2.dev, no custom domain).
- **D1 database**: `rides-db`, ID `928b92ad-f12b-4a40-9647-341f5d63a6ad`, region WEUR; [initial schema](../assets/11-d1-initial-schema.sql) applied remotely (2 tables: `rides`, `ride_tracks`).

**Carsten's open todos (Phase 3 — Cloudflare Access, dashboard only)**, per the locked [auth approach](05-auth-approach.md):

1. **Zero Trust onboarding**: dashboard sidebar → Zero Trust → pick a team name (e.g. `carsten-rides`), choose the **Free** plan (may re-ask for a payment method; stays €0).
2. **Enable Access on the Worker**: Compute → Workers & Pages → `app` → Settings → Domains & Routes → `workers.dev` row → **Enable Cloudflare Access**.
3. **Tighten the policy** (Zero Trust → Access → Applications → the new `app.rides.workers.dev` app): Include rule = **Emails → personal email only** (no "everyone" rule); **Session Duration = 1 month**; login stays default **One-time PIN** (no identity providers).
4. **Test**: open <https://app.rides.workers.dev> in a private window → Access login page → email PIN → stub text. Verified from the agent side too (`curl` must stop returning the stub without auth).

Status check 2026-07-16: URL still returns HTTP 200 publicly → Access not yet enabled. Ticket resolves once step 4 passes.
