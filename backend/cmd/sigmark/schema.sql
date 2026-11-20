CREATE TABLE IF NOT EXISTS reports (
  id uuid PRIMARY KEY,
  batch varchar(32) NOT NULL,
  request_id uuid NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  body jsonb NOT NULL,
  UNIQUE (batch, request_id)
);
CREATE INDEX IF NOT EXISTS reports_received ON reports (received_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS reports_batch_received ON reports (batch, received_at DESC, id DESC);
ALTER TABLE reports ADD COLUMN IF NOT EXISTS trashed_at timestamptz;
CREATE INDEX IF NOT EXISTS reports_trash ON reports (trashed_at) WHERE trashed_at IS NOT NULL;
CREATE TABLE IF NOT EXISTS admin_sessions (
  digest text PRIMARY KEY,
  credential_version text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS admin_sessions_expiry ON admin_sessions(expires_at);
CREATE TABLE IF NOT EXISTS console_settings (
  singleton boolean PRIMARY KEY CHECK(singleton),
  batch varchar(32) NOT NULL,
  uploads_enabled boolean NOT NULL DEFAULT true
);
