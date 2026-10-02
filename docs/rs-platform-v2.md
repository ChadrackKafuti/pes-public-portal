# CAFI RS Platform v2 — Architecture & Product Proposal

**Status:** Proposal · September 2026
**Scope:** the next generation of the CAFI Monitor / PES public portal, aligned with the *CAFI Remote Sensing Platform* concept note (May 2025) and the *PES Remote-Sensing Integration* technical specification (v1.1, July 2026).
**Audience:** CAFI Secretariat, UNDP, GIS administrators, developers.

---

## Résumé exécutif (FR)

La version actuelle du portail est un visualiseur statique : elle affiche une carte web ArcGIS, des filtres et un graphique de couvert forestier précalculé par contrat. La note conceptuelle et la spécification technique décrivent bien davantage : des indicateurs satellitaires par contrat et par visite de suivi, des analyses à la demande sur des zones d'intérêt dessinées ou importées, des alertes de déforestation et de feux, des tableaux de bord juridictionnels, et un retour terrain participatif.

Cette proposition recommande une **sortie progressive et hybride de l'écosystème ArcGIS**, en trois mouvements :

1. **Frontend ouvert** — remplacer le SDK ArcGIS JS (~6 Mo) par MapLibre GL JS (< 1 Mo), en conservant React, l'i18n FR/EN et les composants existants.
2. **Backend d'analyse dédié** — implémenter le pipeline de la spécification (Google Earth Engine, fenêtres de référence et courantes, tables de résultats) comme un service Python conteneurisé écrivant dans PostGIS, au lieu d'un outil de géotraitement ArcGIS Enterprise.
3. **Une seule porte d'accès aux données** — une API (FastAPI) qui sert tuiles vectorielles et indicateurs, avec authentification Keycloak pour le personnel et les vérificateurs, et un niveau public limité aux vues tabulaires anonymisées prévues par la spécification.

La première version cible le **personnel du programme et les vérificateurs indépendants** ; le portail public actuel reste en ligne, inchangé, jusqu'à la phase 2.

---

## 1. Executive summary

Today's portal (this repository) is a well-built but fundamentally **static viewer**: an ArcGIS web map, filters, a code search, and one precomputed tree-cover chart per contract. The concept note and the RS specification describe a **monitoring platform**: per-record satellite indicators, on-demand AOI analyses, deforestation and fire alerts, jurisdictional dashboards, and field feedback loops.

This proposal recommends:

- **A hybrid, phased ArcGIS exit — not a big-bang rewrite.** ArcGIS Enterprise stays the system of record for PES vector data short-term (the PES management system already syncs into it; zero migration risk). Everything *around* it is rebuilt on an open stack, behind an API, so the Enterprise dependency can later be retired without touching the frontend again.
- **Frontend:** MapLibre GL JS + deck.gl replaces the ArcGIS JS SDK. React 19, Zustand, the FR/EN i18n system, design tokens, charts, and the filter logic in this repo all carry over.
- **Backend:** a Python **RS Analysis Service** (FastAPI + Google Earth Engine + PostGIS + a job queue) implements the technical specification's pipeline as a containerized cloud service instead of an ArcGIS Enterprise geoprocessing tool.
- **Auth & privacy:** Keycloak OIDC (the PES system's existing identity provider) gates the staff/verifier tier. The public tier only ever sees the curated, geometry-free outputs that §9 of the specification mandates.
- **First release** serves programme staff and verifiers (module M2 below). The current public portal remains live and untouched until phase 2 replaces it.

## 2. Where the current platform falls short

Measured against the two documents, the current portal has structural gaps that no amount of incremental work on the existing stack will close:

| # | Gap | Detail |
|---|-----|--------|
| 1 | **Display-only** | Every analysis is precomputed elsewhere (`PES_contracts_analysis_sheet_view`). No AOI drawing/upload, no on-demand computation, no per-monitoring-visit indicators, no baseline-vs-current comparison — the core of the RS spec. |
| 2 | **Alerts is a placeholder** | The spec computes RADD/VIIRS/MODIS indicators per record; the concept note calls for daily deforestation alerts and monthly fire/burned-area products with notifications. Today: a "coming soon" card. |
| 3 | **No jurisdictional tier** | The concept note's second pillar (GADM-level analytics for NDC support) has no counterpart at all. |
| 4 | **No identity** | No login, so no staff/verifier tier, no worklists, no per-user AOIs or subscriptions, and the privacy line of spec §9 (public = tabular, no geometry) cannot be drawn — today the public app exposes parcel geometry directly from the feature services. |
| 5 | **Bundle weight** | The ArcGIS JS SDK forces a ~6 MB JS budget (`scripts/check-size.mjs`). Heavy for the region's connectivity — the audience the platform most needs to reach. |
| 6 | **Presentation split across three places** | PES symbology/popups live in portal-authored web map JSON, forest-governance popups live in ~1,200 lines of Arcade hand-ported into this repo, and everything else is React. Three rendering languages, two deployment paths, one CORS workaround (the build-time web map snapshot exists only because `geosmart.undp.org` sends no CORS headers). |
| 7 | **Static hosting ceiling** | GitHub Pages cannot run jobs, hold secrets, call the PES Open API, or talk to GEE. The concept note's platform is unreachable from here. |

What *is* worth keeping: the React app architecture (single shared map stage, Zustand store, typed FR/EN i18n, design tokens, Chart.js analyses, portable `buildWhere` filter logic, URL state). All of it is ArcGIS-free and carries into v2.

## 3. Recommended architecture

### 3.1 The decision: hybrid, phased ArcGIS exit

Four options were weighed:

| Option | Licence & lock-in | Capability vs concept note | Migration risk | Verdict |
|---|---|---|---|---|
| **A. Stay fully on ArcGIS** (Experience Builder / JS SDK + Enterprise GP tool + SDE) | High — JS SDK, Arcade, web-map JSON, Enterprise licences, portal admin bottleneck | Weak: on-demand GEE analyses, custom alerts and public/private tiers fight the platform rather than use it | None | Rejected: it reproduces the ceiling we are trying to escape |
| **B. Frontend-only swap** (MapLibre, keep reading FeatureServer directly) | Medium — frontend free, data and pipeline still Enterprise-shaped | Partial: still no backend, so gaps 1–4 and 7 remain | Low | Good first step but not a destination |
| **C. Fully ArcGIS-free now** (migrate all data to PostGIS immediately) | None | Full | High — the PES management system's sync into Enterprise is outside our control; breaking it blocks everything | Rejected as a first move |
| **D. Hybrid, phased exit** ← recommended | Shrinks every phase | Full | Low — each phase ships value independently; Enterprise is demoted to an upstream, then optional | **Recommended** |

The insight that makes D cheap: **everything the frontend consumes today is plain ArcGIS FeatureServer `/query` over CORS** on `geosmarthosting.undp.org` — a protocol any HTTP client can speak (`f=geojson`). Nothing at runtime needs the portal, the JS SDK, or Arcade. And this repo has *already* abandoned portal-managed presentation for the forest-governance layers (the Arcade files were hand-ported into `src/arcade/`). The "GIS staff edit the web map, no deploy needed" benefit is half gone already; v2 finishes the move to code-managed, versioned, reviewable styling.

### 3.2 Target architecture

```
                        ┌─────────────────────────────────────────────┐
                        │                 Users                       │
                        │  staff/verifiers (Keycloak)   public (anon) │
                        └───────────────┬─────────────────────────────┘
                                        │ HTTPS
                        ┌───────────────▼─────────────────┐
                        │   Web app (React 19 + MapLibre) │  static hosting / CDN
                        └───────────────┬─────────────────┘
                                        │ REST + vector tiles
                        ┌───────────────▼─────────────────┐
                        │   API — FastAPI on Cloud Run    │  OIDC (Keycloak), tiers,
                        │   /contracts /aoi /alerts       │  privacy curation (§9)
                        │   /admin-units /tiles           │
                        └──────┬──────────────┬───────────┘
                               │              │
                 ┌─────────────▼───┐   ┌──────▼──────────────────────┐
                 │    PostGIS      │   │  RS Analysis Service        │
                 │  results, AOIs, │◄──┤  (Python workers, Cloud     │
                 │  subscriptions, │   │  Tasks queue + Scheduler)   │
                 │  jurisd. stats, │   │  = the RS spec pipeline     │
                 │  sync mirror    │   └──────┬──────────┬───────────┘
                 └─────────────────┘          │          │
                                       ┌──────▼───┐  ┌───▼──────────────┐
                                       │ Google   │  │ PES Open API     │
                                       │ Earth    │  │ (Keycloak OAuth2)│
                                       │ Engine   │  │ + ArcGIS Enter-  │
                                       └──────────┘  │ prise (upstream) │
                                                     └──────────────────┘
```

**Components:**

- **Web app** — React 19 + TypeScript + Vite, **MapLibre GL JS** for the map (vector tiles, GeoJSON, raster tile overlays), **deck.gl** only if/when large point clouds or raster analytics visualisation demand it. Reuses from this repo: Zustand store, typed i18n, tokens, UI atoms, Chart.js, `buildWhere`, URL state, hash-router page structure. Target: < 1 MB entry JS (vs 6 MB today).
- **API** — FastAPI on Cloud Run. The **single data door** for the frontend. Serves JSON analytics, GeoJSON features, and vector tiles; enforces auth tiers and the §9 privacy rules. ArcGIS FeatureServer becomes an *internal upstream* the API syncs/proxies — the frontend never talks to Esri endpoints again, so Enterprise can be retired later with zero frontend changes.
- **RS Analysis Service** — the technical specification, lifted off ArcGIS Enterprise. Same object model, same windows, same indicators, same operational safeguards (run lock, time budget, retries, health log, incremental processing, geometry hash) — implemented as Python workers on a Cloud Tasks queue, triggered by Cloud Scheduler (the spec's 20-minute cadence), writing to PostGIS instead of SDE. GEE via a dedicated service account, exactly as the spec prescribes. The spec's §11 formulas port verbatim (they are already GEE semantics).
- **PostGIS (Cloud SQL)** — results + operational tables (spec §6), plus the new v2 tables (AOIs, subscriptions, jurisdictional stats) and a synced mirror of the PES vector layers for tiling.
- **Tiles** — [martin](https://github.com/maplibre/martin) (or `ST_AsMVT` directly in the API) for dynamic layers; **PMTiles** on object storage for static/reference layers (admin boundaries, forest-governance layers, suitability rasters) — served CDN-cheap with no server in the path.
- **Auth** — Keycloak, the PES system's existing IdP. One SSO for PES management system + RS platform. Roles: `public` (anonymous), `staff`, `verifier`, `admin`.

### 3.3 What happens to the ArcGIS pieces

| Today | v2 |
|---|---|
| Web map JSON snapshot + `WebMap.fromJSON` | Gone. Layer catalog + styles defined in code (versioned, reviewable) |
| Portal-authored PES popups/symbology | React popup components + MapLibre style layers |
| Arcade popups & symbology (`src/arcade/`) | Ported to TypeScript once (the logic is lookups + string formatting; `FeatureSetByName` becomes an API join) |
| FeatureServer `/query` from the browser | API endpoints + vector tiles; FeatureServer consumed server-side during transition |
| Suitability MapServers (`*_allowed`) | Exported once to raster tiles / PMTiles (they are static products) |
| `cb_forest_ingest` notebook publishing `Hosted/Protected_areas` (governance layers 0–6 + `CB_Documents`) | **Ported** — `services/governance` runs the same ETL (WDPA, WRI atlases, geocfcl, CAFI shapefiles) into `gov_areas`/`gov_documents`; the API serves them as GeoJSON and the map renders them with the ported symbology/popups. The hosted-service publish step retires |
| ArcGIS Enterprise GP tool + SDE (per spec) | RS Analysis Service + PostGIS |
| Esri basemaps | Free MapLibre-compatible sources (OSM, Esri's open tiles where licence allows, Protomaps) + Sentinel-2 cloudless imagery |

## 4. Platform modules

### M1 — Map workspace (rebuilt core)

The shared-map-stage pattern of the current app survives; the engine changes.

- Layer catalog with the current groups (PES layers, forest governance, admin, suitability) served as vector/raster tiles; bilingual display names (`forestLabels` pattern kept).
- Filters: port `buildWhere` + the field-candidate config as-is; filters become API query params compiled server-side (same semantics, one implementation for map, lists and exports).
- Code search: `GET /search?code=…` across applications/contracts/visits, replacing the four sequential layer queries.
- Feature inspection: typed React popups replacing `<arcgis-feature>` + Arcade; related records (zoning, documents) via API joins.
- Basemaps, legend, layer list: MapLibre-native equivalents (all exist as maintained OSS components or are trivial to build on the current UI atoms).

### M2 — PES monitoring & verification (first-release centrepiece)

Turns the spec's `pes_rs_objects` table into the daily working screen for staff and verifiers:

- **Contract dossier**: parcel map, application + monitoring visits timeline, and per-record indicators — tree cover at object date, 5-yr baseline deforestation rate, current-period loss, RADD/VIIRS/MODIS counts — with the spec's semantics surfaced honestly: *blank ≠ zero*, `tc_coverage`, `baseline_years`, `status/partial`, geometry source badges.
- **Baseline vs current** comparison views per activity, using concept-note Table 1's payment indicators and monitoring intervals (quarterly tree density/mortality for agroforestry & reforestation; semestrial tree cover + burned area for regeneration; annual tree-cover loss for SFM/conservation).
- **Verifier worklists**: records whose current-period indicators breach thresholds (candidate field-visit triggers, per the concept note's "field work only when RS sheds doubt" principle), plus the exceptions queue (`no_usable_geometry`, `oversize_gt_5000ha`, …) as actionable items instead of an invisible table.
- **Run health**: a small ops page over `pes_rs_runs` — is the pipeline alive, what got skipped, why.
- Report export (PDF/XLSX) per contract/visit for verification files.

### M3 — AOI analyses (on demand)

The concept note's fourth data source, and the biggest functional leap:

- Draw an AOI on the map, or upload GeoJSON / KML / zipped shapefile; validated with the spec's guards (max 5,000 ha default, complexity limits, tiling above 1,000 ha).
- Choose analyses → async job on the same indicator engine as M2 → results panel (map layers + charts + table) and export.
- Available at launch (public GEE datasets, spec formulas): land cover composition (Dynamic World), tree cover at date, tree-cover loss between dates, RADD alert density, VIIRS fire alerts, MODIS burned area, canopy height (Meta/WRI 1 m + GEDI).
- Jobs, quotas and result retention are per-user (Keycloak identity).

### M4 — Alerts (replacing the placeholder)

- Subscriptions per contract, per AOI, or per admin unit: RADD deforestation (daily cadence), VIIRS fire (near-real-time), MODIS burned area (monthly).
- An **alert inbox** with triage states (new → under review → confirmed / dismissed → site check requested), so alerts drive the verification workflow instead of just rendering pixels.
- Notification fan-out: email first; webhook to the PES management system (the integration the concept note asks for) second.
- Implementation: scheduled GEE queries per subscribed geometry, diffed into an `alerts` table — no new science needed for v1 of this module.

### M5 — Jurisdictional dashboards

- Precomputed statistics per GADM 0/1/2 unit (and the existing `CAFI_admin_0/1` layers): annual tree cover, loss, alert counts, burned area; later cropland extent, biomass, population via partner datasets (§5).
- A dashboard route per unit with trend charts and CSV/XLSX export ("useful data supporting NDCs and programme development").
- Cheap to operate: a yearly + monthly batch job writing one modest table; served entirely from PostGIS.

### M6 — Site check & feedback (later phase)

- Geotagged-photo review alongside RS indicators (the photo layers already exist as `PES_API_GeoTagged_*`).
- "Request site check" from an alert or a breached threshold → task with mobile data-collection integration (KoboToolbox/ODK per the concept note).
- Crowdsourced validation campaigns (CEO-style labelling of change points) feeding the validation framework — explicitly R&D-adjacent, phased last.

## 5. Analysis roadmap — honest triage of the concept note's ten analyses

| Analysis (concept note Table 5) | v2 status | Basis |
|---|---|---|
| Land cover classification | **Launch** (Dynamic World 9-class) → **Later** (19-class DDD legend) | DW is operational now; the DDD legend needs the FAO partnership + trained models |
| Deforestation & degradation | **Launch** for loss (DW tree mask + Hansen GFC cross-check); **R&D** for degradation & driver attribution | Degradation detection and driver models are research deliverables, not configuration |
| Deforestation alerts | **Launch** (RADD, Congo Basin native) | Spec already uses it |
| Fire alerts & burned area | **Launch** (VIIRS + MODIS MCD64A1) | Spec already uses them |
| Canopy height & tree density | **Launch** for height (Meta/WRI 1 m map + GEDI); **R&D** for per-tree density time series | The concept note itself flags the DiNOv2 time-series application as untested |
| Cropland extent & changes | **Near-term** (ESA WorldCereal, DW crops class) | Partner-grade product exists; fine driver analysis is R&D |
| Biomass | **Near-term** (ESA CCI Biomass / CTrees) → **R&D** for 10 m annual change | Matches the CTrees partnership row |
| Population & density | **Near-term** (WorldPop, GHSL) | Served jurisdictionally; no in-house modelling at first |
| Urban expansion | **Near-term** (GHSL built-up time series) | Same |
| Agricultural potential | **R&D** | Needs the WUR-style co-designed methodology |

Rule of thumb baked into the design: **the platform ships with what public, peer-reviewed datasets support today, and the architecture (modular indicator engine, per-analysis adapters) leaves a socket for each R&D deliverable** — so partnerships plug in without re-architecture.

## 6. Data model & API sketch

### 6.1 PostGIS schema (core)

- **Spec §6 tables, ported verbatim in meaning:** `pes_rs_objects` (one row per application/visit, all indicator + quality fields), `pes_rs_exceptions`, `pes_rs_queue`, `pes_parcels` (geometry cache incl. `geom_input_hash`), `pes_rs_runs`, plus an advisory lock replacing `pes_rs_lock`.
- **v2 additions:** `users` (Keycloak subject mirror), `aois` (owner, geometry, source: drawn/uploaded), `analysis_jobs` (aoi_id, analysis set, status, results JSONB, GEE task ids), `alert_subscriptions`, `alerts` (subscription_id, date, kind, pixel count, geometry point/extent, triage state), `admin_stats` (gid, year/month, metric, value), and mirrored PES vector tables for tiling (`applications`, `contracts`, `visits`, `photos`, forest-governance layers) refreshed from the Enterprise upstream.

### 6.2 REST surface (illustrative)

```
GET  /api/contracts?country=&activity=&…        # filters = ported buildWhere semantics
GET  /api/contracts/{code}                      # dossier: attributes + parcel + timeline
GET  /api/contracts/{code}/indicators           # pes_rs_objects rows for the family
GET  /api/search?code=…                         # application/contract/visit code search
POST /api/aoi            GET /api/aoi/{id}      # draw/upload, list own
POST /api/aoi/{id}/analyses  GET /api/jobs/{id} # request + poll async results
GET  /api/alerts?state=new                      # inbox   POST /api/alert-subscriptions
GET  /api/admin-units/{gid}/stats?metric=&from= # jurisdictional series
GET  /tiles/{layer}/{z}/{x}/{y}.pbf             # vector tiles (martin/ST_AsMVT)
GET  /api/health/runs                           # pipeline run health (admin)
```

### 6.3 Privacy tiers (spec §9, enforced in one place)

- **Public (anonymous):** curated tabular indicators only — no coordinates, no geometry, no place names below admin level, surrogate ids replacing `object_id`; hidden fields per spec recommendation (`geom_input_hash`, `status`, `failed_indicators`, `attempts`). Jurisdictional dashboards are fully public.
- **Staff/verifier (OIDC):** full geometry, dossiers, worklists, AOI tools, alerts.
- Because the API is the only door, this line is enforced in exactly one codebase — impossible in today's direct-to-FeatureServer architecture.

## 7. Migration & phasing

**P0 — Foundations (short)**
Monorepo restructure: `apps/web`, `services/api`, `services/pipeline`, `packages/shared` (types, i18n). Cloud project, Cloud SQL/PostGIS, Cloud Run, Keycloak client registration, GEE service account, CI/CD. The current portal keeps deploying from its own path, untouched.

**P1 — Staff/verifier MVP**
Pipeline v1 at spec parity (incremental fetch from PES Open API, parcel resolution, GEE indicators, queue/exceptions/health) → PostGIS. API v1 (contracts, indicators, search, tiles, OIDC). Web app v1: MapLibre map workspace (M1) + monitoring dossiers (M2), FR/EN. Forest-governance styling and popups ported from Arcade to TS. *Exit criteria:* a verifier can open a contract, see baseline vs current indicators with quality flags, and export a report.

**P2 — Analyses & alerts; public tier**
M3 AOI analyses (draw/upload → async GEE jobs). M4 alert subscriptions + inbox + email. Public tier ships on the new stack (curated views + jurisdictional dashboards) → the GitHub Pages viewer is retired. Suitability layers converted to PMTiles.

**P3 — Jurisdictional depth & feedback**
M5 full jurisdictional dashboards + exports. M6 site check & feedback with mobile-collection integration. R&D sockets exercised with the first partner deliverable (e.g. DDD land-cover legend or CTrees biomass). Predictive/risk analytics prototype (fire risk, deforestation risk from historical patterns + proximity drivers).

**Risks & mitigations**

| Risk | Mitigation |
|---|---|
| PES Open API access scopes/quotas not granted to a new service | It's the same API the spec's tool already consumes; request a parallel client credential early in P0 |
| GEE quota / service-account governance | Same dependency as the spec; the queue + time-budget design (spec §5) already handles throttling |
| Enterprise sync ownership (PES system → ArcGIS) is outside this project | That's exactly why Enterprise stays upstream in P1–P2; the mirror-sync isolates us from its schema drift |
| Two stacks live during P1 | The old portal is frozen, not developed; P1 has no public-facing deliverable, so no duplication |
| Arcade → TS porting errors | Snapshot tests comparing popup output for a fixture set of features before switch-over |

## 8. Open questions for stakeholders

Resolved (P0 kickoff, Sept 2026):

1. ~~**Hosting ownership**~~ — **CAFI operates the cloud project.** IAM, billing and data-processing agreements sit with the CAFI Secretariat.
2. ~~**System of record end-state**~~ — **the PES management system delivers data through its Open API.** The platform's PostGIS is therefore the system of record for RS outputs and mirrored PES vectors; ArcGIS Enterprise is not in the v2 data path (it remains only behind the frozen portal-v1 viewer until P2 retires it).

Still open:

3. **Alert SLA:** what latency and false-positive tolerance do verifiers actually need? Drives the RADD polling cadence and triage design in M4.
4. **Public-tier policy:** confirm the §9 line (tabular-only) also applies to *contract locations at admin-unit granularity* on public dashboards, or whether coarse choropleths are acceptable.
5. **Partner sequencing:** which R&D socket lands first (FAO DDD land cover, CTrees biomass, WUR indicators)? Shapes P3.
6. **Mobile collection tooling:** KoboToolbox vs ODK vs the PES system's own mobile app for M6 site checks.

## 9. Build record — M7: portal-v1 valorization (Oct 2026)

Shipped in sequence, one PR per milestone, on top of the live pipeline (hourly
ingest, GEE indicators, governance ETL) and the ABC-Map-inspired shell:

- **M7a — Geotagged photos** (PR #16): both PES endpoints' photo arrays flatten
  into `pes_photos` with v1's stable identity (sha1 of parent/field/index/
  URL-without-query/coords); images mirror into a private Supabase Storage
  bucket under a per-run budget; `pes_raw_records` mirrors full payload JSONB.
  API serves photo points and short-lived signed image URLs; map photo layer +
  dossier gallery with lightbox.
- **M7b — Application dossier at v1 depth** (PR #17):
  `/api/applications/{id}/profile` assembles the v1 ArcGIS popup content from
  the raw mirror (stage tracker, contract timeline, visit schedule,
  beneficiary/project/contract sections, latest-visit performance, fire-risk
  category, area comparison); the dossier and map popup render it EN/FR.
- **M7c — Governance inspector** (PR #18): full-depth feature inspector in the
  map sidebar (chips, KPI tiles, zoning donut, parent/zones, CFCL procedure
  tracker, national source attributes, PA/forest-title overlaps via PostGIS,
  documents grouped by v1's twelve categories).
- **M7d — Analyses + annual indicators** (PR #19): `indicators/annual.py`
  computes per-application annual Dynamic World tree-cover series (2016→) with
  derived loss, plus dominant land cover at application date vs current
  (`pes_annual_indicators` + `landcover_*` columns, 007 migration); the
  Analyses page serves v1's contract analysis (pickers, description sentence,
  KPIs, line/bar charts, data table, citation). The backlog drains inside each
  hourly run's leftover time budget.
- **M7e — Landing, filters, country profile** (PR #20): v1 landing hero with
  the two entry CTAs and data-attribution footer (map moves to `/map`); map
  sidebar Filters section (eight dimensions + code search + date range,
  client-side with Apply/Reset and match count); dashboard gains v1's
  country-overview aggregates (pipeline by stage, gender split, fire-risk
  profile, overdue count) computed from the raw mirror.

---

*This document is the v2 design baseline. Each phase should open with a short technical design note (schema migrations, endpoint contracts, style catalog) against this baseline.*
