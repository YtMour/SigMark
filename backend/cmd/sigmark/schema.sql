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
CREATE TABLE IF NOT EXISTS device_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label varchar(60) NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS asset_installations (
  digest char(64) PRIMARY KEY,
  asset_id uuid NOT NULL REFERENCES device_assets(id)
);
ALTER TABLE reports ADD COLUMN IF NOT EXISTS asset_id uuid REFERENCES device_assets(id);
CREATE INDEX IF NOT EXISTS reports_active_asset ON reports (asset_id,received_at DESC) WHERE trashed_at IS NULL AND asset_id IS NOT NULL;
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
-- Keep the reference visible after report purge; never retain a copy of report data here.
CREATE TABLE IF NOT EXISTS regression_baselines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(60) NOT NULL,
  report_id uuid NOT NULL,
  expect_unlock boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS regression_baseline_name ON regression_baselines (lower(name));
