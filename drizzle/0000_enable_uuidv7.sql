-- Supported by Neon and the local PostgreSQL stack. Fail if unavailable;
-- canonical application IDs must never silently fall back to UUIDv4.
CREATE EXTENSION IF NOT EXISTS pg_uuidv7;
