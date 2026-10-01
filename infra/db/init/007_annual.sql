-- M7d: annual Dynamic World indicators (the v1 contract-analysis sheet)
-- and the dominant land-cover classes behind the dossier's Land Cover card.

CREATE TABLE IF NOT EXISTS pes_annual_indicators (
  application_id text NOT NULL,
  year           smallint NOT NULL,
  tc_ha          double precision,
  loss_ha        double precision,
  tc_window_days integer,
  tc_coverage    double precision,
  computed_utc   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (application_id, year)
);

ALTER TABLE pes_rs_objects ADD COLUMN IF NOT EXISTS landcover_at_app text;
ALTER TABLE pes_rs_objects ADD COLUMN IF NOT EXISTS landcover_at_app_pct double precision;
ALTER TABLE pes_rs_objects ADD COLUMN IF NOT EXISTS landcover_current text;
ALTER TABLE pes_rs_objects ADD COLUMN IF NOT EXISTS landcover_current_pct double precision;
ALTER TABLE pes_rs_objects ADD COLUMN IF NOT EXISTS landcover_current_date date;
