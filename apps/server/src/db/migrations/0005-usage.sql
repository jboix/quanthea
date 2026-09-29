-- The usage ledger: what each model step spent, and each view of a pinned dashboard. No foreign
-- keys: the ledger outlives the threads and dashboards it names.
CREATE TABLE usage_events (
  id TEXT PRIMARY KEY,
  at INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('model', 'pinned_view')),
  thread_id TEXT,
  dashboard_id TEXT,
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

CREATE INDEX usage_events_by_time ON usage_events (at);
