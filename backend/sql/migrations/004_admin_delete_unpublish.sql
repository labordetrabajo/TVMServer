-- TVM Server v0.3.1. Migración incremental: NO modifica ni borra videos existentes.
BEGIN;
CREATE TABLE IF NOT EXISTS file_deletion_queue (
  id uuid PRIMARY KEY,
  stored_name text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  retry_after timestamptz NOT NULL DEFAULT now(),
  last_error text
);
CREATE INDEX IF NOT EXISTS file_deletion_queue_retry_idx
  ON file_deletion_queue(retry_after,created_at);
COMMIT;
