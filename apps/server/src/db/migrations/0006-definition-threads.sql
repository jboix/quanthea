-- A thread can make definitions: a conversation with an assistant that proposes them, which a
-- person saves. Its steps count in the usage ledger as their own feature. SQLite changes a CHECK
-- only by building the table again: each table is rebuilt the documented way, a new table, the
-- rows copied, the old one dropped, the new one renamed. The runner turns foreign keys off around
-- a migration, so the messages, plans, alerts and reports that refer to a thread keep their rows,
-- and checks every reference before the commit.

CREATE TABLE threads_next (
  id TEXT PRIMARY KEY,
  title TEXT,
  state TEXT NOT NULL DEFAULT 'idle'
    CHECK (state IN ('idle', 'plan_pending', 'building', 'ready')),
  dashboard_id TEXT REFERENCES dashboards (id) ON DELETE SET NULL,
  tokens_used INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  -- The model provider the thread uses. NULL, or a provider that was removed, means the default.
  provider_id TEXT,
  -- The recipes the thread uses, as JSON: {"mode":"default"}, {"mode":"chosen","ids":[...]} or
  -- {"mode":"free"}. NULL means the default set.
  recipes TEXT,
  deleted_at INTEGER,
  deleted_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  -- What the thread makes, chosen when it starts and fixed.
  kind TEXT NOT NULL DEFAULT 'dashboard'
    CHECK (kind IN ('dashboard', 'alert', 'report', 'definition')),
  -- For an alert thread, the panel it starts from, as JSON `{"dashboardId", "version", "panelId"}`.
  seed TEXT
);

INSERT INTO threads_next (
  id, title, state, dashboard_id, tokens_used, created_by, provider_id, recipes,
  deleted_at, deleted_by, created_at, updated_at, kind, seed
)
SELECT
  id, title, state, dashboard_id, tokens_used, created_by, provider_id, recipes,
  deleted_at, deleted_by, created_at, updated_at, kind, seed
FROM threads;

DROP TABLE threads;

ALTER TABLE threads_next RENAME TO threads;

CREATE INDEX threads_in_bin ON threads (deleted_at) WHERE deleted_at IS NOT NULL;

CREATE TABLE usage_events_next (
  id TEXT PRIMARY KEY,
  at INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('model', 'pinned_view', 'snapshot_view')),
  thread_id TEXT,
  dashboard_id TEXT,
  -- Who the model step ran for: the owner of its thread, kept after the thread is purged.
  user_id TEXT,
  -- The provider's name, as configured.
  provider TEXT,
  -- Who the step's requests reached, such as `gemini`, from the provider's kind and base URL. NULL
  -- for views, and for steps recorded before it was kept: their provider names no vendor.
  vendor TEXT,
  model TEXT,
  job TEXT,
  input INTEGER NOT NULL DEFAULT 0,
  cached_input INTEGER NOT NULL DEFAULT 0,
  cache_write INTEGER NOT NULL DEFAULT 0,
  output INTEGER NOT NULL DEFAULT 0,
  -- The list price at the time, in millionths of a dollar; NULL when the model had no price.
  cost_micros INTEGER,
  feature TEXT
    CHECK (feature IN ('building', 'question', 'explanation', 'alert', 'report', 'definition'))
);

INSERT INTO usage_events_next (
  id, at, kind, thread_id, dashboard_id, user_id, provider, vendor, model, job,
  input, cached_input, cache_write, output, cost_micros, feature
)
SELECT
  id, at, kind, thread_id, dashboard_id, user_id, provider, vendor, model, job,
  input, cached_input, cache_write, output, cost_micros, feature
FROM usage_events;

DROP TABLE usage_events;

ALTER TABLE usage_events_next RENAME TO usage_events;

CREATE INDEX usage_events_by_time ON usage_events (at);
