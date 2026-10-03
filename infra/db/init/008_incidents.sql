-- M23: near-real-time incidents — RADD deforestation and VIIRS fire
-- detections per parcel become stateful incidents (open → responded →
-- verified/dismissed, or auto-resolved when the signal clears), plus the
-- rotation state that paces the NRT checks across runs.

CREATE TABLE IF NOT EXISTS pes_incidents (
  incident_uid   text PRIMARY KEY,          -- <application_id>:<kind>:<first_detected>
  application_id text NOT NULL,
  kind           text NOT NULL,             -- 'deforestation' | 'fire'
  first_detected date NOT NULL,
  last_detected  date NOT NULL,
  magnitude      double precision,          -- alert pixels (defor) / detections (fire)
  status         text NOT NULL DEFAULT 'open',  -- open|responded|verified|dismissed|resolved
  status_note    text,
  status_by      text,
  status_utc     timestamptz,
  created_utc    timestamptz NOT NULL DEFAULT now(),
  updated_utc    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_incidents_status ON pes_incidents (status, kind);
CREATE INDEX IF NOT EXISTS idx_incidents_app ON pes_incidents (application_id);

CREATE TABLE IF NOT EXISTS pes_nrt_state (
  application_id text PRIMARY KEY,
  checked_utc    timestamptz NOT NULL DEFAULT now(),
  defor_alerts   integer,
  fire_alerts    integer
);
