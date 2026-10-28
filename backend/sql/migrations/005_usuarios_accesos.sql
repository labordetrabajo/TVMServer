-- TVM Server v0.3.2: habilitación/deshabilitación de usuarios. No elimina datos.
BEGIN;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
COMMIT;
