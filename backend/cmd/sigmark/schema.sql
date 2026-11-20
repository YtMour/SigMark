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
