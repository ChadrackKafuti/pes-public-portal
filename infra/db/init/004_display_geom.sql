-- Simplified display geometry for the governance layers: what the map
-- serves by default (the 41k-polygon COD zoning layer is unusable at full
-- vertex detail over the wire). Populated by the ingest; full geometry
-- stays in geom_geojson.

ALTER TABLE gov_areas ADD COLUMN IF NOT EXISTS geom_display jsonb;
