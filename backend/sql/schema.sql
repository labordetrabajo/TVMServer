BEGIN;
CREATE TABLE IF NOT EXISTS clients (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 150),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  email text NOT NULL,
  password_hash text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  role text NOT NULL CHECK (role IN ('admin','client')),
  client_id uuid REFERENCES clients(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT role_client CHECK ((role='admin' AND client_id IS NULL) OR (role='client' AND client_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users (lower(email));
CREATE TABLE IF NOT EXISTS sessions (
  token_hash char(64) PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS totems (
  id uuid PRIMARY KEY,
  code text NOT NULL UNIQUE,
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  playlist_version bigint NOT NULL DEFAULT 0,
  last_seen timestamptz,
  device_token_hash char(64),
  device_disk_total bigint,
  device_disk_used bigint,
  device_disk_free bigint,
  device_video_bytes bigint,
  device_files jsonb NOT NULL DEFAULT '[]'::jsonb,
  device_synced_version bigint,
  device_last_error text,
  device_cleanup_generation integer NOT NULL DEFAULT 0,
  device_cleanup_ack integer NOT NULL DEFAULT 0,
  device_reported_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS videos (
  id uuid PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  uploader_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  original_name text NOT NULL,
  sha256 char(64),
  stored_name text NOT NULL UNIQUE,
  bytes bigint NOT NULL CHECK (bytes > 0),
  rejection_reason text,
  media_validation text NOT NULL DEFAULT 'unverified',
  video_codec text,
  audio_codec text,
  media_width integer,
  media_height integer,
  media_fps numeric(7,2),
  duration_seconds numeric(12,2),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS videos_client_idx ON videos(client_id, created_at DESC);
CREATE TABLE IF NOT EXISTS playlist_items (
  totem_id uuid NOT NULL REFERENCES totems(id) ON DELETE CASCADE,
  video_id uuid NOT NULL REFERENCES videos(id) ON DELETE RESTRICT,
  position int NOT NULL CHECK (position >= 0),
  PRIMARY KEY (totem_id, video_id),
  UNIQUE (totem_id, position) DEFERRABLE INITIALLY DEFERRED
);
COMMIT;
