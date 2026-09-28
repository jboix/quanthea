-- Dashboards and their versions. A dashboard has no owner; the acting user is recorded on each
-- version for accountability only.
CREATE TABLE dashboards (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  -- No foreign key: a variant outlives its parent.
  parent_dashboard_id TEXT,
  parent_version INTEGER,
  pinned_version_id TEXT,
  deleted_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Each version holds the whole spec as JSON.
CREATE TABLE dashboard_versions (
  id TEXT PRIMARY KEY,
  dashboard_id TEXT NOT NULL REFERENCES dashboards (id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  spec TEXT NOT NULL,
  change_summary TEXT,
  pinned_at INTEGER,
  actor TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (dashboard_id, version)
);

-- A pinned version never changes and stays pinned, whatever the application code does.
CREATE TRIGGER pinned_versions_are_immutable
BEFORE UPDATE OF spec, version, dashboard_id, pinned_at ON dashboard_versions
WHEN OLD.pinned_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'pinned dashboard versions are immutable');
END;
