# Cloudflare provisioning checklist

Asset of [Cloudflare provisioning checklist](../issues/11-cloudflare-provisioning.md). Splits the work into what only Carsten can do (HITL — account, OAuth login, dashboard toggles) and what the agent runs via `wrangler` once the account is logged in (AFK).

> **Status 2026-07-16 — ALL PHASES DONE ✅**: Phase 1 (account carsten.guhl@googlemail.com, subdomain `rides`, R2 enabled, wrangler logged in) · Phase 2 (D1 `rides-db` id `928b92ad-f12b-4a40-9647-341f5d63a6ad` + schema applied, R2 bucket `rides-gpx`, stub Worker `app` live at <https://app.rides.workers.dev>) · Phase 3 (Access gate on team `autumn-tooth-bc56`, OTP, personal email only, 1-month sessions, preview URLs off — PIN login + 302 gate verified). Full record in the [ticket's Answer](../issues/11-cloudflare-provisioning.md).

## Locked resource names

Chosen here so every later step and `wrangler.jsonc` agree:

| Resource | Name | Binding (in `wrangler.jsonc`) |
|---|---|---|
| Worker | `app` | — (becomes `https://app.rides.workers.dev`) |
| R2 bucket (raw GPX, private) | `rides-gpx` | `GPX_BUCKET` |
| D1 database | `rides-db` | `DB` |

`wrangler` is not installed globally; all commands use `npx wrangler@latest …` (the project will later pin it as a devDependency). Node v25 + npm are already present on this machine.

## Phase 1 — Carsten: account + login (HITL)

1. **Create the Cloudflare account** (free plan) at <https://dash.cloudflare.com/sign-up> — or sign in if one exists. Verify the email address.
2. **Pick the `workers.dev` subdomain** when the dashboard prompts for it (Workers & Pages → first-time setup). ✅ Done 2026-07-16: subdomain = **`rides`** → Workers live at `*.rides.workers.dev`. (Worker name therefore changed from `rides` to `app` to avoid `rides.rides.workers.dev`.)
3. **Enable R2**: dashboard → **R2** → follow the enable flow. Expect a payment-method prompt — Cloudflare requires a card on file to activate R2 even though the free tier (10 GB) costs €0.
4. **Log wrangler in** from a terminal in `~/Sites/rides`:
   ```sh
   npx wrangler@latest login
   ```
   This opens a browser OAuth consent — approve it. Verify with `npx wrangler@latest whoami`.

## Phase 2 — agent (or paste-able): resources via wrangler (AFK)

Run from `~/Sites/rides` after Phase 1. Re-invoking `/wayfinder` on this ticket lets the agent run these and record the outputs.

```sh
# D1 database — note the database_id in the output (goes into wrangler.jsonc)
npx wrangler@latest d1 create rides-db

# R2 bucket — private by default; do NOT enable r2.dev or a custom domain
npx wrangler@latest r2 bucket create rides-gpx

# Apply the initial schema (assets/11-d1-initial-schema.sql)
npx wrangler@latest d1 execute rides-db --remote --file=.scratch/ride-tracker/assets/11-d1-initial-schema.sql
```

**Stub Worker** so the `workers.dev` hostname exists before the Astro app does (Cloudflare Access can only be enabled on an existing Worker). The real deploy later replaces it in place:

```sh
echo 'export default { fetch: () => new Response("rides: provisioning stub") }' > /tmp/rides-stub.js
npx wrangler@latest deploy /tmp/rides-stub.js --name app --compatibility-date 2026-07-16
```

Note the printed URL: `https://app.rides.workers.dev`.

The schema file also becomes the project's first migration when scaffolding starts: copy it to `migrations/0001_init.sql` (the deploy script's `d1 migrations apply --remote` is idempotent, so the pre-applied schema is safe — mark it applied locally with `d1 migrations apply` against the same file name, or simply let `execute` above be skipped and apply purely via migrations if scaffolding happens first).

## Phase 3 — Carsten: Cloudflare Access (HITL, dashboard only)

Per the locked [auth approach](../issues/05-auth-approach.md): edge gate only, no in-Worker JWT validation.

1. **Zero Trust onboarding** (one-time): dashboard → **Zero Trust** → choose a team name (anything, e.g. `carsten-rides`), pick the **Free** plan. This may also ask for a payment method; the plan itself is €0 for ≤50 users.
2. **Enable Access on the Worker**: Workers & Pages → `app` → **Settings → Domains & Routes** → on the `workers.dev` entry click **Enable Cloudflare Access**. This creates an Access application for `app.rides.workers.dev`.
3. **Edit the Access policy** (Zero Trust → Access → Applications → the new app):
   - Policy: **Allow** with a single Include rule — **Email** = your personal email (the one supplied at run time; not stored in this repo).
   - Remove/avoid any broader rule (e.g. "everyone in team").
   - Login method: **One-time PIN** only (Zero Trust → Settings → Authentication — OTP is on by default; don't add identity providers).
   - **Session duration: 1 month** (application settings).
4. **Test**: open the Worker URL in a private window → expect the Access login page → PIN email → stub response. Then confirm the personal email is the only allowed one by trying any other address (should be rejected before a PIN is sent).

## Phase 4 — record the outcome

Resolve the ticket with: account email used, `workers.dev` subdomain, Worker URL, R2 bucket name, D1 database name + `database_id`, Access app name + policy summary. These feed `wrangler.jsonc` and the build effort.
