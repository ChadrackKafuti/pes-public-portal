-- M7a: full-fidelity PES payload mirror + geotagged photos.
-- pes_raw_records keeps each API record verbatim (the v1 popups' field
-- universe); pes_photos is the port of the v1 PhotoLoad hosted layers,
-- with images mirrored into Supabase Storage (SAS photo URLs expire).

CREATE TABLE IF NOT EXISTS pes_raw_records (
  kind        text NOT NULL,              -- application | monitoring_visit
  record_id   text NOT NULL,
  payload     jsonb NOT NULL,
  synced_utc  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, record_id)
);

CREATE TABLE IF NOT EXISTS pes_photos (
  photo_uid        text PRIMARY KEY,      -- sha1(parent|field|index|url|lon|lat)
  kind             text NOT NULL,         -- application | monitoring_visit
  parent_id        text,
  application_id   text,
  application_code text,
  contract_code    text,
  photo_index      int,
  label            text,
  url              text,                  -- latest fetched URL (expiring SAS)
  url_no_query     text,                  -- stable part, feeds the uid
  lon              double precision NOT NULL,
  lat              double precision NOT NULL,
  mirrored_path    text,                  -- storage object path once mirrored
  mirror_status    text,                  -- done | error | NULL (pending)
  mirror_error     text,
  synced_utc       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pes_photos_application ON pes_photos (application_id);
CREATE INDEX IF NOT EXISTS idx_pes_photos_parent ON pes_photos (parent_id);
