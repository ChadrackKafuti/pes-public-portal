# Deployment — Supabase + Fly.io + Vercel

The interim production stack (until/unless CAFI GCP hosting lands):

| Piece | Runs on | Config in repo |
|---|---|---|
| Postgres (system of record) | **Supabase** | `infra/db/init/*.sql` via the `db-init` workflow |
| API (`services/api`) | **Fly.io** | `services/api/fly.toml`, `deploy-api` workflow |
| Web app (`apps/web`) | **Vercel** | `vercel.json` (build + `/api/*` rewrite to Fly) |
| Governance ingest | **GitHub Actions** (daily) | `ingest-governance` workflow |
| RS pipeline | **GitHub Actions** (manual for now) | `ingest-rs` workflow |

The Vercel rewrite proxies `/api/*` to the Fly app server-side, so the
browser talks same-origin and CORS never comes into play.

## One-time setup

### 1. Supabase
1. Create a project (region close to users, e.g. `eu-west`).
2. Copy the **pooled** connection string (Connect → Transaction pooler,
   port 6543) and append `?sslmode=require`.
3. Add it as the GitHub repository secret `DATABASE_URL`
   (Settings → Secrets and variables → Actions).
4. Run the **db-init** workflow (Actions tab → db-init → Run workflow):
   applies `001_core.sql`, `002_gis.sql`, `003_governance.sql` once each.

### 2. Fly.io (API)
1. `fly launch --no-deploy` is not needed — the app config is committed.
   Create the app once: `fly apps create cafi-rs-api` (pick another name?
   change `app` in `services/api/fly.toml` AND the rewrite in `vercel.json`).
2. Set the runtime secrets:
   ```bash
   fly secrets set -a cafi-rs-api CAFI_DATABASE_URL='<the same Supabase URL>'
   # later, when the Keycloak public client exists (docs/credentials.md §4):
   fly secrets set -a cafi-rs-api CAFI_OIDC_ISSUER='https://keycloak.cafi-pse.org/realms/UNPES'
   ```
3. Create a deploy token: `fly tokens create deploy -a cafi-rs-api`, add it
   as the GitHub secret `FLY_API_TOKEN`.
4. Run the **deploy-api** workflow (it also auto-deploys on pushes to
   `main` touching `services/api/`). Check `https://cafi-rs-api.fly.dev/api/health`.

### 3. Vercel (web)
1. Import the GitHub repo in Vercel. Framework preset: **Other**; leave
   Root Directory at the repository root — `vercel.json` sets the build
   command (`npm run build:web`) and output (`apps/web/dist`).
2. No env vars needed for the anonymous phase. When Keycloak auth goes
   live, set `VITE_OIDC_AUTHORITY` / `VITE_OIDC_CLIENT_ID` (see
   docs/credentials.md §4) and add the Vercel domain to the Keycloak
   client's redirect URIs.

### 4. Data
- Run the **ingest-governance** workflow once by hand (defaults: all
  countries, skip-large, smart mode). It then runs daily at 03:43 UTC.
  Secrets used: `DATABASE_URL`, `WDPA_TOKEN`.
- The **ingest-rs** workflow is manual-dispatch only, on purpose: it
  writes real PES monitoring data, and until `CAFI_OIDC_ISSUER` is set on
  Fly the API answers anonymously. Sequence for going live with PES data:
  1. PES admin registers the `cafi-rs-platform` Keycloak client
     (docs/credentials.md §4).
  2. `fly secrets set CAFI_OIDC_ISSUER=...` (API now requires sign-in).
  3. Set the `CAFI_RS_*` secrets on GitHub (same names/values as the
     Claude environment: PES API base + token URL + client id/secret +
     username/password, GEE service account + key).
  4. Dispatch **ingest-rs**; when happy, add a `schedule:` block
     (e.g. `17 * * * *`) to the workflow.

## Notes
- All schedules/dispatches run from the default branch (`main`) — merge
  PR #1 first, or dispatch from the branch via the Actions UI.
- GitHub Actions secrets are not exposed to fork PRs; scheduled runs use
  repository secrets only.
- The governance ingest is incremental (`smart` mode): the daily run
  refetches only sources whose signature changed, plus the periodic
  WDPA/geocfcl refresh (`GOV_FORCE_REFRESH_DAYS`, default 7).
- The COD Séries d'Aménagement layer (41k polygons) stays excluded by
  `skip_large` until its first supervised run.
