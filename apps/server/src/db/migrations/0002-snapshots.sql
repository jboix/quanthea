-- Snapshot links: a dashboard version frozen with the results its panels showed. The id is the
-- unguessable part of the link (128 random bits). A snapshot goes when its time is up, when someone
-- revokes it, or with its dashboard when the dashboard's thread is purged.
CREATE TABLE snapshots (
  id TEXT PRIMARY KEY,
  dashboard_id TEXT NOT NULL REFERENCES dashboards (id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  title TEXT NOT NULL,
  -- The time range the panels ran over, in epoch milliseconds.
  time_from INTEGER NOT NULL,
  time_to INTEGER NOT NULL,
  -- JSON: the variable values, and the ids of the hidden sets of markers.
  variables TEXT NOT NULL,
  hidden_markers TEXT NOT NULL,
  -- JSON: the version's spec, and each panel's run by panel id.
  spec TEXT NOT NULL,
  panels TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  -- Who took it, for accountability only: it gives them no rights over it.
  taken_by TEXT NOT NULL,
  taken_at INTEGER NOT NULL,
  -- NULL: it lives until someone revokes it.
  expires_at INTEGER
);

CREATE INDEX snapshots_by_dashboard ON snapshots (dashboard_id, taken_at);

CREATE INDEX snapshots_by_expiry ON snapshots (expires_at) WHERE expires_at IS NOT NULL;

-- The usage ledger also counts views of snapshots. SQLite changes a CHECK only by building the
-- table again.
CREATE TABLE usage_events_next (
  id TEXT PRIMARY KEY,
  at INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('model', 'pinned_view', 'snapshot_view')),
  thread_id TEXT,
  dashboard_id TEXT,
  -- Who the model step ran for: the owner of its thread, kept after the thread is purged.
  user_id TEXT,
  provider TEXT,
  model TEXT,
  job TEXT,
  input INTEGER NOT NULL DEFAULT 0,
  cached_input INTEGER NOT NULL DEFAULT 0,
  cache_write INTEGER NOT NULL DEFAULT 0,
  output INTEGER NOT NULL DEFAULT 0,
  -- The list price at the time, in millionths of a dollar; NULL when the model had no price.
  cost_micros INTEGER
);

INSERT INTO usage_events_next (
  id, at, kind, thread_id, dashboard_id, user_id, provider, model, job,
  input, cached_input, cache_write, output, cost_micros
)
SELECT
  id, at, kind, thread_id, dashboard_id, user_id, provider, model, job,
  input, cached_input, cache_write, output, cost_micros
FROM usage_events;

DROP TABLE usage_events;

ALTER TABLE usage_events_next RENAME TO usage_events;

CREATE INDEX usage_events_by_time ON usage_events (at);
