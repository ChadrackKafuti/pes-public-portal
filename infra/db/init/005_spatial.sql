-- Spatial column + index over the governance geometries (PostGIS from
-- 002_gis.sql), kept in sync by trigger so the ingest needs no change.
-- Powers the M3 AOI analysis (ST_Intersects / ST_Intersection in SQL).

ALTER TABLE gov_areas ADD COLUMN IF NOT EXISTS geom geometry(Geometry, 4326);

CREATE OR REPLACE FUNCTION gov_areas_sync_geom() RETURNS trigger AS $$
BEGIN
  BEGIN
    NEW.geom := ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(
      coalesce(NEW.geom_display, NEW.geom_geojson)::text), 4326));
  EXCEPTION WHEN OTHERS THEN
    -- one unparsable ring must not sink a whole ingest batch
    NEW.geom := NULL;
  END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_gov_areas_sync_geom ON gov_areas;
CREATE TRIGGER trg_gov_areas_sync_geom
  BEFORE INSERT OR UPDATE OF geom_geojson, geom_display ON gov_areas
  FOR EACH ROW EXECUTE FUNCTION gov_areas_sync_geom();

-- Backfill existing rows (no-op geometry-affecting update fires the trigger).
UPDATE gov_areas SET geom_geojson = geom_geojson WHERE geom_geojson IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_gov_areas_geom ON gov_areas USING gist (geom);
