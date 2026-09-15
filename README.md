# CAFI Monitor — public web app

Hand-coded public version of the "CAFI Monitor, Earth Observation and Land-Use Intelligence Platform" Experience Builder
app (portal item iMonitor_App). Built with React 19 + TypeScript (Vite), the ArcGIS Maps SDK for JavaScript 5.x (map
components), Calcite components, Zustand and react-router. Live: https://chadrackkafuti.github.io/pes-public-portal/

Pages: **Map** (side panel with Overview / Filters / Layers tabs, "find by application code" search, country overview
dashboard and feature popups from the web map, the seven Congo Basin forest-governance layers with their Arcade popups),
**Analyses** (contract picker, tree cover and tree cover loss per year from the contracts analysis table), **Alerts**
(placeholder). English / French.

The forest-governance layers ("Other areas of interest": concessions, community forests, local territories, their zoning,
protected areas, documents table) come from the public service `Hosted/Protected_areas` built by `cb_forest_ingest.py`
and replace the three legacy layers of the web map at load time (`src/services/forestLayers.ts`; popups and symbology in
`src/arcade/`, copied from `CAFI Spatial Reporting/arcade`). Their titles are fixed because the popups find related layers
by name; the layer list shows translated display names instead (`src/i18n/forestLabels.ts`).

## Code layout

```
src/app/         main.tsx, routes.tsx (hash router, lazy pages), AppShell.tsx (top bar, shared map stage, footer)
src/core/        store.ts (Zustand: filters, panel UI, selection, AOI, KPI, contract), url.ts, hooks.ts
src/services/    webmap.ts, forestLayers.ts, layers.ts (PES layers, popups, presets), query.ts (cache + abort), analysis.ts
src/features/    map/ (MapStage: the single <arcgis-map>, MapPage panels, layers/legend/basemap), filters/, inspector/
                 (feature panel, code search), analyses/, alerts/, landing/
src/components/  ui/ (glass atoms, KPI cards, tabs, bottom sheet, notices)  -  CSS Modules on the tokens in src/theme/
src/i18n/        typed dictionaries (en.ts is the key source, fr.ts must match), plurals, number/date formatting
src/theme/       tokens.css (design tokens), tokens.ts (mirror for Chart.js / ArcGIS symbols, parity-tested), global.css
```

There is exactly one `MapView` for the whole app: `MapStage` is mounted once by the shell and the Map and Analyses routes
only overlay their panels on it (Analyses switches to a "contracts only" visibility preset and restores it on leave).
Quality gates: `npm run lint`, `npm run typecheck`, `npm test` (Vitest), `npm run build` (includes a bundle-size budget).

## How it gets its content

The app is driven by the public web map **"PES GIS Portal Map"** (item `4c1d00b58291441b8ed0b2e5874af871`).
Layers, symbology, popups and layer groups are therefore managed in the portal's Map Viewer, not in code.

The geosmart.undp.org portal does not send CORS headers, so a browser on another domain cannot read portal items.
`scripts/fetch-webmap.mjs` therefore snapshots the web map JSON into `public/webmaps/` (item ids in
[webmaps.config.json](webmaps.config.json)); the app builds the map with `WebMap.fromJSON()` and the layers load live
from geosmarthosting.undp.org, which does allow cross-origin requests. The snapshot is refreshed by
`npm run fetch:webmaps` (automatic before every build, and the GitHub Pages workflow also rebuilds daily), so a change
made in the Map Viewer is online at the next deployment. Portal-proxied basemap layers ("UN Image Map" image services)
are dropped from the snapshot; Esri World Imagery remains.

Filters are applied as definition expressions to every feature layer of the map whose URL contains `Hosted/PES_API_`
(fields that a layer does not have are ignored). Everything that points at the GIS platform is in
[src/config.ts](src/config.ts).

## Run locally

```bash
npm install
npm run dev
```

Build: `npm run build` (output in `dist/`), preview the build: `npm run preview`.

To build locally with the GitHub Pages base path, set `BASE_PATH` first. In PowerShell: `$env:BASE_PATH = "/pes-public-portal/"; npm run build`.
In Git Bash prefix the command with `MSYS_NO_PATHCONV=1`, otherwise the shell rewrites the value into a Windows path.

## Publish on GitHub Pages

1. Create an empty repository on GitHub (e.g. `pes-public-portal`), then in this folder:
   ```bash
   git init
   git add .
   git commit -m "PES GIS Portal public web app"
   git branch -M main
   git remote add origin https://github.com/<user>/pes-public-portal.git
   git push -u origin main
   ```
2. In the repository settings, **Pages → Build and deployment → Source: GitHub Actions**.
3. Every push to `main` runs [.github/workflows/deploy.yml](.github/workflows/deploy.yml) and publishes
   `https://<user>.github.io/pes-public-portal/`. For a custom domain set `BASE_PATH: /` in the workflow.

## Branding

- `public/branding/cafi-logo.png` — CAFI logo (recovered from the Experience Builder app).
- `public/branding/undp-logo.svg` — **placeholder**; replace with the official UNDP logo (keep the file name).

## Notes

- Basemaps: the web map's own basemap (Esri World Imagery, key-free classic tile service) plus Topographic, Streets and
  OpenStreetMap. No API key is needed.
- The Survey123 link is hidden while `CONFIG.links.survey` is empty (the current form item is not public).
- The Alerts page is a placeholder; wire the alerts table in `src/pages/alertsPage.ts` when it is published.
