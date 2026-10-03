-- M28: NICFI basemap change checks — per managed/conservation parcel, a
-- before/after comparison of Planet monthly mosaics looking for new roads,
-- skid trails or clearings. Detections open 'road' incidents in the M23
-- state machine; this table paces the rotation and keeps the last reading.

CREATE TABLE IF NOT EXISTS pes_basemap_checks (
  application_id   text PRIMARY KEY,
  checked_utc      timestamptz NOT NULL DEFAULT now(),
  mosaic_recent    text,
  mosaic_reference text,
  new_road         boolean,
  new_clearing     boolean,
  confidence       double precision,
  summary          text
);
