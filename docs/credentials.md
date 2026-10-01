# Setting up credentials — PES Open API & Google Earth Engine

Two secrets unlock the pipeline's first live run. Neither is ever committed:
locally they live in a `.env` file (gitignored); in production they live in the
CAFI cloud project's secret manager and reach the containers as environment
variables (spec §2.1: "credentials are supplied through protected environment
settings and are not stored in the tool or output tables").

## 1. PES Open API (Keycloak client credentials)

**The actual values** (confirmed with the PES team, Sept 2026 — these are the
PRODUCTION endpoints; the user/secret values are confidential):

| Value | Environment variable | Value |
|---|---|---|
| API base URL | `CAFI_RS_PES_API_BASE` | `https://api.cafi-pse.org` |
| Token endpoint | `CAFI_RS_PES_OIDC_TOKEN_URL` | `https://keycloak.cafi-pse.org/realms/UNPES/protocol/openid-connect/token` |
| Client id | `CAFI_RS_PES_CLIENT_ID` | `arcgis-pes-client` |
| Client secret | `CAFI_RS_PES_CLIENT_SECRET` | *(secret)* |
| Service username | `CAFI_RS_PES_USERNAME` | *(secret)* |
| Service password | `CAFI_RS_PES_PASSWORD` | *(secret)* |

The realm uses the OAuth2 **password grant** (resource-owner credentials):
the token request sends `grant_type=password` with the client id/secret AND
the service user's username/password, as `application/x-www-form-urlencoded`.
The pipeline client does this by default; `CAFI_RS_PES_GRANT_TYPE=client_credentials`
switches the flow if the realm ever offers a machine-to-machine client.

**Verify** (prints a token, then one page of applications):

```bash
TOKEN=$(curl -s -X POST "$CAFI_RS_PES_OIDC_TOKEN_URL" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d grant_type=password \
  -d client_id="$CAFI_RS_PES_CLIENT_ID" \
  -d client_secret="$CAFI_RS_PES_CLIENT_SECRET" \
  -d username="$CAFI_RS_PES_USERNAME" \
  -d password="$CAFI_RS_PES_PASSWORD" | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
curl -s -H "Authorization: Bearer $TOKEN" \
  "$CAFI_RS_PES_API_BASE/api/v1/applications?page=1&pageSize=2" | head -c 2000
```

These are production credentials: read-only use, never committed, never
pasted into chats or logs.

**If the API returns 401 "User is not authorized" although the token is
valid**, the integration user is not fully provisioned. Per the *PES Open API
Technical Specification* v1.0 §3, every request must pass ALL of:

1. valid bearer token;
2. the user exists in the internal PES users table;
3. the user is active;
4. the user has the dedicated **Third Party Integration** role;
5. the user is linked to an **active integration platform configuration**;
6. the endpoint is enabled for integration access;
7. the platform has read access to the endpoint's dataset
   (`/api/v1/applications` → *Applications*, `/api/v1/monitoring-visits` →
   *Monitoring*);
8. the requested data falls in the platform's organization scope.

Integration users are provisioned per platform (§3.1: "ArcGIS Integration
User", "Power BI Integration User", …), so an account working for another
integration does not imply this one is provisioned. **Ask the PES
administrators to provision a "CAFI RS Platform" integration user**: Third
Party Integration role, an active platform configuration with read access to
the **Applications** and **Monitoring** datasets, and organization scope
`AllOrganizations` (basin-wide monitoring).

API contract (spec §4): `PageNumber`/`PageSize` pagination params and a
`{Items, TotalCount, TotalPages, CurrentPage, PageSize}` response envelope;
fields are PascalCase; a `Country={countryId}` filter exists. The spec's
example payloads lag the live API: ContractCode is present on both
applications and monitoring visits (confirmed by the PES team, Sept 2026).
The pipeline client implements this contract.

While you have that sample payload, compare its field names against
`FIELD_CANDIDATES` in `services/pipeline/pes_rs_pipeline/pes_api.py` — that
table is the only place to adjust if a name differs.

## 2. Google Earth Engine (service account)

One-time setup in the CAFI Google Cloud project (console.cloud.google.com):

1. **Create/choose the GCP project** (e.g. `cafi-rs-platform`). Enable the
   **Earth Engine API** (APIs & Services → Enable APIs → "Google Earth Engine
   API").
2. **Create a service account** (IAM & Admin → Service Accounts), e.g.
   `rs-pipeline@cafi-rs-platform.iam.gserviceaccount.com`. It needs no special
   GCP roles for Earth Engine computation; add `roles/serviceusage.serviceUsageConsumer` on the project.
3. **Register the project for Earth Engine** at
   https://console.cloud.google.com/earth-engine (choose commercial or
   noncommercial — a UN/CAFI monitoring use normally qualifies as
   noncommercial; the registration flow decides). The service account in a
   registered project is what grants EE access.
4. **Credentials to the pipeline** — two options:
   - **Production (recommended):** run the pipeline on Cloud Run **as** that
     service account (no key file at all — Application Default Credentials).
     Set only `CAFI_RS_GEE_SERVICE_ACCOUNT` to the account's email.
   - **Local / non-GCP:** create a JSON key for the service account, keep it
     outside the repo, and set `GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json`
     plus `CAFI_RS_GEE_SERVICE_ACCOUNT`.
5. **RADD access**: the RADD alert collection
   (`projects/radar-alert/assets/v1/alerts_africa`) is publicly readable; no
   extra grant needed. Dynamic World, VIIRS and MCD64A1 are public catalog
   datasets.

**Verify** (from `services/pipeline` with the `compute` extra installed):

```bash
python -c "import ee; ee.Initialize(); print(ee.Image('USGS/SRTMGL1_003').getInfo()['id'])"
```

## 2a. Geotagged-photo mirror (Supabase Storage)

The photo arrays in the two PES endpoints carry image URLs with **expiring
SAS query strings**, so the pipeline mirrors the images into a private
Supabase Storage bucket and the API serves short-lived signed URLs.

One-time setup (Supabase dashboard → Storage):

1. **Create a bucket** named `pes-photos`, **private** (public off).
2. Copy the project's **service_role key** (Settings → API → service_role —
   NOT the anon key; it bypasses RLS and must never reach a browser).
3. Add it as GitHub Actions secret **`CAFI_SUPABASE_SERVICE_KEY`**. The
   ingest-rs workflow passes it to the pipeline, and deploy-api stages it
   onto Fly as `CAFI_SUPABASE_SERVICE_KEY` for URL signing.

Without the key, photo points still sync (map/dossier show "image not yet
available"); mirroring and signed URLs activate on the first run after the
secret exists.

## 2b. Governance ingest (WDPA + public GIS sources)

`services/governance` (the ported `cb_forest_ingest` workflow) needs:

| Variable | Value |
|---|---|
| `WDPA_TOKEN` | Protected Planet API token (https://api.protectedplanet.net/request) |
| `GOV_LOCAL_DATA_DIR` | Optional: folder holding the CAFI consolidated shapefiles (`CFCL_*`, `PSAT_*`). Sources are skipped with a warning when absent |
| `GOV_COUNTRIES` / `GOV_LAYERS` | Optional subsets for bounded runs, e.g. `GOV_COUNTRIES=GNQ` |

> **Rotate the WDPA token.** The old token sits in plain text inside the
> `PROD_Other_areas` notebook; request a fresh one and set it only as an
> environment secret (it is deliberately not in the repo).

The ingest fetches from public services that must be on the environment's
network allowlist before a live run:

- `services3.arcgis.com`, `services9.arcgis.com`, `services2.arcgis.com`,
  `services6.arcgis.com`, `services7.arcgis.com` (WRI country atlases)
- `gis.forest-atlas.org` (Forest Atlas MapServer + document attachments)
- `rdc.geocfcl.org` (DRC CFCL registry + document pages)
- `api.protectedplanet.net` (WDPA)
- `geosmarthosting.undp.org` (CAFI admin 0/1 lookup only — the last ArcGIS
  dependency; snapshotting admin boundaries into the repo would remove it)

## 3. Where the variables go

- **Local:** copy `services/pipeline/.env.example` to `.env` (same for
  `services/api`) and fill the values; pydantic-settings picks them up.
- **Cloud Run:** store the client secret (and key, if any) in Secret Manager;
  mount as env vars on the pipeline job/service. Everything non-secret is a
  plain env var.
- **CI:** not needed — tests run without credentials by design.

## 4. First live run checklist

```bash
cd services/pipeline
pip install -e ".[compute]"
python -m pes_rs_pipeline.runner   # one run: fetch -> compute -> PostGIS
```

Then check `pes_rs_runs` (or `GET /api/health/runs`) for the health row, and
`pes_rs_objects` / `GET /api/applications` for the first indicator rows.
Expected first-run friction, in order: a field name differing from
`FIELD_CANDIDATES`, the RADD band names, GEE quota on large parcels.


## 4. Platform login

Two providers; the API accepts both at once (routing by token issuer),
the web app uses OIDC when configured, else Supabase.

### 4a. Supabase Auth (available now — no PES-admin dependency)

CAFI manages the platform users in its own Supabase project (the Ground
Impact pattern). Users are invited from the Supabase dashboard; there is
no self-signup.

| Where | Variable | Value |
|---|---|---|
| API (Fly secret) | `CAFI_SUPABASE_URL` | `https://<ref>.supabase.co` |
| API (Fly secret, optional) | `CAFI_SUPABASE_JWT_SECRET` | only for legacy-secret projects; omit to verify against the project JWKS |
| Web (Vercel) | `VITE_SUPABASE_URL` | same project URL |
| Web (Vercel) | `VITE_SUPABASE_ANON_KEY` | the anon public key |

### 4b. Keycloak OIDC (once the PES admin registers the client)

The staff tier authenticates against the same `UNPES` realm. Ask the PES
Keycloak admin to register one more client for the platform UI:

- Client id `cafi-rs-platform`, **public** client (no secret), Standard flow
  (authorization code) with **PKCE S256** required.
- Valid redirect URIs + web origins: the platform's URL(s), e.g.
  `https://rs.cafi.org/*` and `http://localhost:5173/*` for development.

Configuration:

- API (Cloud Run env): `CAFI_OIDC_ISSUER=https://keycloak.cafi-pse.org/realms/UNPES`,
  `CAFI_OIDC_CLIENT_ID=cafi-rs-platform`. Empty issuer disables auth (dev only).
- Web (build-time): `VITE_OIDC_AUTHORITY` + `VITE_OIDC_CLIENT_ID`
  (see `apps/web/.env.example`). Unset authority disables the login gate.

The API validates tokens locally against the realm's JWKS (issuer, expiry,
signature, azp/aud client binding); `/api/health` stays unauthenticated.
