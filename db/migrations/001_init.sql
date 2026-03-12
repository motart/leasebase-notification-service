-- notification_service schema initialization
-- Idempotent: safe to re-run on existing databases (IF NOT EXISTS guards).
--
-- Run as leasebase_admin:
--   psql -h <host> -U leasebase_admin -d leasebase -f db/migrations/001_init.sql

SET search_path TO notification_service, public;

-- ── notifications ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notifications (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     TEXT NOT NULL,
  recipient_user_id   TEXT NOT NULL,
  sender_user_id      TEXT,
  title               TEXT NOT NULL,
  body                TEXT NOT NULL,
  type                TEXT NOT NULL DEFAULT 'general',
  related_type        TEXT,
  related_id          TEXT,
  read_at             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_recipient
  ON notifications(recipient_user_id, organization_id);
CREATE INDEX IF NOT EXISTS idx_notifications_org
  ON notifications(organization_id);
CREATE INDEX IF NOT EXISTS idx_notifications_created
  ON notifications(created_at DESC);
