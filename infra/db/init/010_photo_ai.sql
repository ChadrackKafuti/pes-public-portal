-- M26: photo intelligence — one Claude vision pass per mirrored geotagged
-- photo: scene classification, consistency with the declared PES activity,
-- tree/sapling count, vegetation health, species guess, and red flags.

ALTER TABLE pes_photos ADD COLUMN IF NOT EXISTS ai_scene text;
ALTER TABLE pes_photos ADD COLUMN IF NOT EXISTS ai_scene_confidence double precision;
ALTER TABLE pes_photos ADD COLUMN IF NOT EXISTS ai_activity_consistent boolean;
ALTER TABLE pes_photos ADD COLUMN IF NOT EXISTS ai_tree_count integer;
ALTER TABLE pes_photos ADD COLUMN IF NOT EXISTS ai_health text;
ALTER TABLE pes_photos ADD COLUMN IF NOT EXISTS ai_species text;
ALTER TABLE pes_photos ADD COLUMN IF NOT EXISTS ai_flags text;        -- comma-joined
ALTER TABLE pes_photos ADD COLUMN IF NOT EXISTS ai_summary text;
ALTER TABLE pes_photos ADD COLUMN IF NOT EXISTS ai_model text;
ALTER TABLE pes_photos ADD COLUMN IF NOT EXISTS ai_status text;       -- ok | failed
ALTER TABLE pes_photos ADD COLUMN IF NOT EXISTS ai_processed_utc timestamptz;

CREATE INDEX IF NOT EXISTS idx_pes_photos_ai_pending
  ON pes_photos (synced_utc) WHERE ai_processed_utc IS NULL;
