-- CAFI RS Platform — core pipeline schema (RS specification §6, SDE -> Postgres).
-- Deliberately PostGIS-free: parcels cache the RAW geometry inputs as delivered
-- by the PES API (spec §6.4); PostGIS arrives in 002_gis.sql with the mirrored
-- vector layers. v2 additions (AOIs, subscriptions, jurisdictional stats) land
-- in P2 migrations.

CREATE TYPE object_type AS ENUM ('application', 'monitoring_visit');
CREATE TYPE geom_source AS ENUM
  ('polygon', 'buffered_point', 'polygon_inherited', 'buffered_point_inherited');
CREATE TYPE processing_status AS ENUM ('ok', 'partial', 'partial_final');

-- §6.1 main indicator results: one row per application or monitoring visit.
CREATE TABLE pes_rs_objects (
  object_id              text PRIMARY KEY,
  object_type            object_type NOT NULL,
  object_date            date NOT NULL,
  application_id         text NOT NULL,
  pes_activity           text,
  parcel_area_ha         double precision NOT NULL,
  tree_cover_ha          double precision,
  defor_5yr_ha_yr        double precision,
  defor_current_ha       double precision,
  defor_alerts_5yr       integer,
  defor_alerts_current   integer,
  fire_alerts_5yr        integer,
  fire_alerts_current    integer,
  burned_area_5yr_ha     double precision,
  burned_area_current_ha double precision,
  current_start          date,
  geom_source            geom_source NOT NULL,
  tc_window_days         integer,
  tc_coverage            double precision,
  baseline_years         integer,
  status                 processing_status NOT NULL DEFAULT 'ok',
  failed_indicators      text[] NOT NULL DEFAULT '{}',
  attempts               integer NOT NULL DEFAULT 0,
  geom_input_hash        text NOT NULL,
  processed_utc          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON pes_rs_objects (application_id);
CREATE INDEX ON pes_rs_objects (object_date);

-- §6.2 records that could not be processed.
CREATE TABLE pes_rs_exceptions (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  object_id       text NOT NULL,
  object_type     object_type NOT NULL,
  object_date     date,
  area_gis        double precision,
  reason          text NOT NULL,
  geom_source     geom_source,
  geom_input_hash text,
  attempts        integer NOT NULL DEFAULT 0,
  run_utc         timestamptz NOT NULL DEFAULT now()
);

-- §6.3 deferred future items and pending retries.
CREATE TABLE pes_rs_queue (
  object_id         text PRIMARY KEY,
  object_type       object_type NOT NULL,
  object_date       date,
  status            text NOT NULL,
  attempts          integer NOT NULL DEFAULT 0,
  reason            text,
  ee_task_id        text,
  geom_input_hash   text,
  next_attempt_date date,
  enqueued_utc      timestamptz NOT NULL DEFAULT now()
);

-- §6.4 application parcel cache (visits inherit the parent parcel across runs).
-- Raw inputs, verbatim from the PES API: shape as WKT/JSON text, point as lon/lat.
CREATE TABLE pes_parcels (
  application_id    text PRIMARY KEY,
  application_date  date NOT NULL,
  shape_raw         text,
  point_lon         double precision,
  point_lat         double precision,
  estimated_area_ha double precision,
  pes_activity      text,
  geom_input_hash   text NOT NULL,
  updated_utc       timestamptz NOT NULL DEFAULT now()
);

-- §6.5 run-health log: one row per scheduled run.
CREATE TABLE pes_rs_runs (
  run_id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  start_utc      timestamptz NOT NULL,
  end_utc        timestamptz,
  duration_s     double precision,
  fetched_app    integer,
  fetched_mon    integer,
  fetch_app_ok   boolean,
  fetch_mon_ok   boolean,
  selected       integer,
  ok             integer,
  partial        integer,
  skipped        integer,
  queued         integer,
  stopped_reason text,
  note           text
);

-- §6.6 run lock is an advisory lock in PostGIS (pg_advisory_lock), not a table.
