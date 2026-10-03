-- M29b: finer monitoring series —
--  * monthly Sentinel-2 NDVI per parcel and its control annulus
--    (cropping-intensity phenology + fine greening trajectory)
--  * per-year burned area (the fire-exclusion timeline)
--  * yearly fragmentation metrics for conservation/SFM parcels

CREATE TABLE IF NOT EXISTS pes_ndvi_monthly (
  application_id text NOT NULL,
  month          date NOT NULL,      -- first day of the month
  ndvi           double precision,   -- parcel mean; NULL = no clear imagery
  control_ndvi   double precision,   -- surrounding annulus mean
  computed_utc   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (application_id, month)
);

ALTER TABLE pes_annual_indicators ADD COLUMN IF NOT EXISTS burned_ha double precision;
ALTER TABLE pes_annual_indicators ADD COLUMN IF NOT EXISTS patch_count integer;
ALTER TABLE pes_annual_indicators ADD COLUMN IF NOT EXISTS edge_m_per_ha double precision;
