-- Forest-governance layers (cb_governance ingest — the ported cb_forest_ingest
-- workflow). Columns mirror the notebook's FIELDS_COMMON (cb_governance/schema.py);
-- per-layer extra fields live in extras jsonb, geometry as GeoJSON jsonb
-- (WGS84) so no PostGIS extension is needed.

CREATE TABLE IF NOT EXISTS gov_areas (
  src_uid            text PRIMARY KEY,
  layer              text NOT NULL,
  country            text,
  iso3               text,
  sub_type_std       text,
  sub_type_raw       text,
  name               text,
  reference          text,
  holder             text,
  operator           text,
  community          text,
  province           text,
  province_src       text,
  admin2             text,
  admin3             text,
  admin4             text,
  link_key           text,
  status_raw         text,
  status_std         text,
  status_mgmt_raw    text,
  status_mgmt_std    text,
  date_attr          timestamptz,
  date_conv_prov     timestamptz,
  date_conv_def      timestamptz,
  date_plan          timestamptz,
  date_expiry        timestamptz,
  area_adm_ha        double precision,
  area_sig_ha        double precision,
  area_calc_ha       double precision,
  doc_count          integer,
  situation          text,
  country_check      text,
  centroid_x         double precision,
  centroid_y         double precision,
  programme          text,
  funder             text,
  agency             text,
  partner            text,
  year_ref           smallint,
  geom_quality       text,
  src_layer          text,
  src_url            text,
  src_oid            integer,
  src_globalid       text,
  src_file           text,
  src_vintage        text,
  src_last_edit      timestamptz,
  src_attrs_json     text,
  src_attrs_trunc    smallint,
  retired            smallint NOT NULL DEFAULT 0,
  loaded_at          timestamptz,
  parent_uid         text,
  extras             jsonb NOT NULL DEFAULT '{}'::jsonb,
  geom_geojson       jsonb
);

CREATE INDEX IF NOT EXISTS idx_gov_areas_layer
  ON gov_areas (layer, retired, situation);
CREATE INDEX IF NOT EXISTS idx_gov_areas_parent
  ON gov_areas (parent_uid);
CREATE INDEX IF NOT EXISTS idx_gov_areas_iso3
  ON gov_areas (iso3);

-- Public documents attached to concessions / community forests / protected
-- areas (join parent_uid -> gov_areas.src_uid).
CREATE TABLE IF NOT EXISTS gov_documents (
  doc_uid            text PRIMARY KEY,
  parent_uid         text,
  parent_layer       text,
  country            text,
  iso3               text,
  title              text,
  category_std       text,
  category_raw       text,
  file_name          text,
  content_type       text,
  size_bytes         integer,
  date_doc           timestamptz,
  author             text,
  url                text,
  src_system         text,
  retired            smallint NOT NULL DEFAULT 0,
  loaded_at          timestamptz
);

CREATE INDEX IF NOT EXISTS idx_gov_documents_parent
  ON gov_documents (parent_uid);

-- Incremental update state: one row per configured source (notebook §6B,
-- formerly cb_forest_ingest_state.json).
CREATE TABLE IF NOT EXISTS gov_ingest_state (
  state_key      text PRIMARY KEY,
  fingerprint    text,
  success_epoch  double precision,
  success_utc    timestamptz,
  loaded         integer,
  retired        integer
);

-- Run health, mirroring pes_rs_runs for the ops page.
CREATE TABLE IF NOT EXISTS gov_runs (
  run_id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  start_utc     timestamptz NOT NULL,
  end_utc       timestamptz,
  duration_s    double precision,
  update_mode   text,
  layers        text,
  countries     text,
  fetched       integer,
  loaded        integer,
  retired       integer,
  failed        integer,
  docs          integer,
  fetch_errors  jsonb,
  stats         jsonb
);
