-- M25: 1 m canopy-height metrics (static Meta/WRI model, once per parcel)
-- and the counterfactual control series — tree cover of the surrounding
-- annulus per year, stored in hectares scaled to the parcel's own area so
-- it overlays the contract series directly.

ALTER TABLE pes_rs_objects ADD COLUMN IF NOT EXISTS canopy_mean_m double precision;
ALTER TABLE pes_rs_objects ADD COLUMN IF NOT EXISTS canopy_pct_gt3m double precision;
ALTER TABLE pes_rs_objects ADD COLUMN IF NOT EXISTS canopy_utc timestamptz;

ALTER TABLE pes_annual_indicators ADD COLUMN IF NOT EXISTS control_tc_ha double precision;
