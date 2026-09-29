# CAFI RS Platform

Monorepo for the CAFI Remote Sensing Platform — near-real-time monitoring of CAFI-funded
activities in the Congo Basin. Design baseline: [docs/rs-platform-v2.md](docs/rs-platform-v2.md).

Decisions locked in P0: the platform is **hosted by CAFI**, and the **PES management system
delivers data through its Open API** — so PostGIS is the platform's system of record and
ArcGIS Enterprise is not in the v2 data path.

## Layout

```
apps/portal-v1/     the current public portal (CAFI Monitor), frozen; still deploys to
                    GitHub Pages daily. Not an npm workspace member on purpose — its
                    dependency graph must not change. See its own README.
apps/web/           v2 frontend: React 19 + MapLibre GL. Skeleton (map + API health).
packages/shared/    shared TypeScript types (spec §6 object model).
services/api/       FastAPI — the single data door (indicators, contracts, tiles, auth tiers).
services/pipeline/  RS Analysis Service — the PES RS spec v1.1 pipeline as a containerized
                    worker (PES Open API → parcels → GEE indicators → PostGIS). The pure
                    logic (config §8, temporal windows §11.7, point buffer §11.8) is
                    implemented and tested; fetch/GEE/DB wiring lands in P1.
infra/              local dev stack (PostGIS + Keycloak + API) and the core SQL schema.
docs/               design documents.
```

## Develop

```bash
# v2 frontend (proxies /api to localhost:8000)
npm install && npm run dev:web

# backend stack
docker compose -f infra/docker-compose.dev.yml up

# pipeline tests
cd services/pipeline && pip install -e ".[dev]" && pytest

# legacy portal (self-contained)
cd apps/portal-v1 && npm install && npm run dev
```

## Phasing

P0 (this scaffold) → P1 staff/verifier MVP (pipeline at spec parity, API v1, map workspace,
monitoring dossiers) → P2 AOI analyses + alerts + public tier (retires portal-v1) →
P3 jurisdictional dashboards + site check & feedback. Details in the design doc §7.
