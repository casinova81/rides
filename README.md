# Rides

Private ride-tracking app built with Astro and deployed as one Cloudflare Worker,
with D1 for ride data and R2 for GPX files. The existing Cloudflare Access gate
protects the site. Uploading a ride does not require rebuilding the app.

## Development

Use Node.js 24 (the CI version), then run `npm ci` and `npm run dev`.
Local development uses simulated D1/R2 storage, separate from production.

- `npm run check`: Astro/TypeScript checks.
- `npm test`: unit and local workerd tests, including simulated D1/R2.
- `npm run build`: production build, including Cesium runtime assets.

## GitHub Actions deployment

[Build and deploy](.github/workflows/cloudflare.yml) runs on pull requests targeting
`main` and pushes to `main`. It installs locked dependencies with `npm ci`, then
typechecks, tests, and builds the app without Cloudflare credentials.

Only a successful push build on `main` proceeds to production deployment. That
job uses the existing `npm run deploy` command, preserving the required order:
typecheck, apply remote D1 migrations, build, deploy with Wrangler. The second
build is intentional: the production pipeline stays identical to the local
fallback and cannot skip migrations. Both builds automatically stage Cesium
assets through `prebuild`.

Production workflow runs are serialized and do not cancel an active deployment.
GitHub may replace an older pending run with a newer one. Superseded PR runs are
cancelled. PRs never deploy, apply remote migrations, or receive the Cloudflare
credentials; there are no preview deployments.

### One-time setup

Before merging the workflow, add these **repository Actions secrets** under
Settings > Secrets and variables > Actions:

| Secret | Value |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | A Cloudflare API token scoped to the account hosting the existing Worker, D1 database, and R2 bucket. |
| `CLOUDFLARE_ACCOUNT_ID` | That Cloudflare account's ID. |

Follow Cloudflare's [GitHub Actions authentication guide](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/).
Start with the **Edit Cloudflare Workers** API token template and ensure it
includes **D1: Edit** for remote migrations and the permissions needed for the
existing R2 binding. Scope account resources to this app's account rather than all
accounts. This workflow does not manage Cloudflare Access or create infrastructure.
Never commit the token or copy local Wrangler OAuth credentials into CI.

The deployment fails explicitly if either secret is missing. `wrangler.jsonc`
continues to select the existing `app` Worker, `rides-db` database, and `rides-gpx`
bucket; their non-sensitive identifiers remain committed. Do not enable
Cloudflare Workers Builds alongside this workflow, which would duplicate deploys.

To enforce checks before merging, make **Check, test, and build** a required check
in the repository's `main` branch rules.

### Recovery and local fallback

After fixing a failed deployment (for example, configuring missing secrets),
rerun the failed job in GitHub Actions. For an emergency local deploy, authenticate
with `npx wrangler login` and run `npm run deploy`; avoid doing so while an Actions
deployment is running, since the workflow lock cannot serialize local commands.

`npx wrangler rollback` can restore a previous Worker version, but does not undo
D1 migrations. Keep migrations compatible with the currently deployed Worker:
the migration step precedes the build/deploy and a later failure leaves those
migrations applied.
