# Authentication approach

Type: grilling
Status: resolved
Blocked by: 02

## Question

How is the site kept private — Cloudflare Access (zero-code login, free ≤50 users) vs. a basic-auth Worker (htaccess-style prompt) — and does one gate cover everything (pages, upload endpoint, tile/data assets in R2)?

Use the facts gathered by the Cloudflare architecture research; decide with Carsten based on login feel (email one-time-PIN vs. browser password prompt) and phone-upload convenience.

## Answer

**Cloudflare Access, edge gate only — zero auth code in the project.**

- **Gate**: Cloudflare Access (Zero Trust free tier), enabled via the one-click toggle on the Worker's `workers.dev` domain. No basic-auth Worker, no `run_worker_first`.
- **One gate covers everything: yes.** Access enforces at the edge before any request reaches the Worker, so static assets, SSR pages, and `POST /api/upload` are all behind the same login. R2 stays private (reachable only through the Worker binding), so the GPX files inherit the same gate.
- **Login feel**: email one-time PIN → session cookie with **1-month session duration**. In practice: type a PIN roughly once a month per device; phone uploads are cookie-silent in between.
- **Allow-list**: **personal email only** — deliberately decoupled from the Jakala work identity. The concrete address is supplied when provisioning runs; it is not stored in the repo.
- **In-Worker JWT validation: consciously declined.** Cloudflare's docs recommend validating `Cf-Access-Jwt-Assertion` in the Worker; Carsten chose the edge gate alone (zero code). Accepted risk: an Access dashboard misconfiguration would silently expose the site. Revisit only if that ever becomes a concern.
- **Hostname**: the free `workers.dev` subdomain — no custom domain, which is also what keeps the one-click Access path available.
- **Side effect for local dev**: with no auth code, `astro dev` needs no auth stubbing at all.
