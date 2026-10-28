-- TVM v0.3.3: metadatos MP4 y motivo de rechazo, sin borrar datos anteriores.
BEGIN;
ALTER TABLE videos ADD COLUMN IF NOT EXISTS rejection_reason text;
ALTER TABLE videos ADD COLUMN IF NOT EXISTS media_validation text NOT NULL DEFAULT 'unverified';
ALTER TABLE videos ADD COLUMN IF NOT EXISTS video_codec text;
ALTER TABLE videos ADD COLUMN IF NOT EXISTS audio_codec text;
ALTER TABLE videos ADD COLUMN IF NOT EXISTS media_width integer;
ALTER TABLE videos ADD COLUMN IF NOT EXISTS media_height integer;
ALTER TABLE videos ADD COLUMN IF NOT EXISTS media_fps numeric(7,2);
ALTER TABLE videos ADD COLUMN IF NOT EXISTS duration_seconds numeric(12,2);
COMMIT;
