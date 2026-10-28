-- TVM Server v0.3: migración incremental, preserva videos, usuarios y listas existentes.
BEGIN;
ALTER TABLE videos ADD COLUMN IF NOT EXISTS note text NOT NULL DEFAULT '';
ALTER TABLE videos ADD COLUMN IF NOT EXISTS requested_start_at timestamptz;
ALTER TABLE videos ADD COLUMN IF NOT EXISTS requested_end_at timestamptz;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='videos_note_length_ck') THEN
    ALTER TABLE videos ADD CONSTRAINT videos_note_length_ck CHECK (char_length(note)<=1000);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='videos_requested_dates_ck') THEN
    ALTER TABLE videos ADD CONSTRAINT videos_requested_dates_ck
      CHECK (requested_end_at IS NULL OR (requested_start_at IS NOT NULL AND requested_end_at > requested_start_at));
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS scheduled_publications (
  id uuid PRIMARY KEY,
  video_id uuid NOT NULL REFERENCES videos(id) ON DELETE RESTRICT,
  totem_id uuid NOT NULL REFERENCES totems(id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  status text NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','active','completed','cancelled')),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  completed_at timestamptz,
  CHECK(ends_at IS NULL OR ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS scheduled_publications_due_idx
  ON scheduled_publications(status,starts_at,ends_at);
CREATE INDEX IF NOT EXISTS scheduled_publications_totem_idx
  ON scheduled_publications(totem_id,status);
CREATE UNIQUE INDEX IF NOT EXISTS scheduled_publications_live_unique
  ON scheduled_publications(totem_id,video_id) WHERE status IN ('scheduled','active');
COMMIT;
