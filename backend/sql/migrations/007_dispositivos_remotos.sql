-- TVM v0.4: telemetría y credenciales individuales de cada dispositivo.
-- Idempotente y no borra videos, cuentas ni programaciones anteriores.
BEGIN;
ALTER TABLE totems ADD COLUMN IF NOT EXISTS device_token_hash char(64);
ALTER TABLE totems ADD COLUMN IF NOT EXISTS device_disk_total bigint;
ALTER TABLE totems ADD COLUMN IF NOT EXISTS device_disk_used bigint;
ALTER TABLE totems ADD COLUMN IF NOT EXISTS device_disk_free bigint;
ALTER TABLE totems ADD COLUMN IF NOT EXISTS device_video_bytes bigint;
ALTER TABLE totems ADD COLUMN IF NOT EXISTS device_files jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE totems ADD COLUMN IF NOT EXISTS device_synced_version bigint;
ALTER TABLE totems ADD COLUMN IF NOT EXISTS device_last_error text;
ALTER TABLE totems ADD COLUMN IF NOT EXISTS device_cleanup_generation integer NOT NULL DEFAULT 0;
ALTER TABLE totems ADD COLUMN IF NOT EXISTS device_cleanup_ack integer NOT NULL DEFAULT 0;
ALTER TABLE totems ADD COLUMN IF NOT EXISTS device_reported_at timestamptz;
ALTER TABLE videos ADD COLUMN IF NOT EXISTS sha256 char(64);
COMMIT;
