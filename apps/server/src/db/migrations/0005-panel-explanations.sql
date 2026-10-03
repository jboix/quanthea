-- Explanations of the panels of a version: written from the spec and the schema, never from data,
-- so they are shown to every role. A version's spec never changes, so an explanation stays valid.
-- Asking again adds a row; the latest is shown, the older ones are kept. They go with their
-- dashboard, as questions do.
CREATE TABLE panel_explanations (
  id TEXT PRIMARY KEY,
  dashboard_id TEXT NOT NULL REFERENCES dashboards (id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  panel_id TEXT NOT NULL,
  -- Who asked for it, for accountability only: it gives them no rights over it.
  explained_by TEXT NOT NULL,
  explained_at INTEGER NOT NULL,
  text TEXT NOT NULL,
  -- JSON: the tokens by model, and their sum.
  usage TEXT NOT NULL,
  tokens INTEGER NOT NULL
);

CREATE INDEX panel_explanations_by_panel ON panel_explanations (
  dashboard_id, version, panel_id, explained_at
);

-- An explanation is stored once and never rewritten.
CREATE TRIGGER panel_explanations_are_kept
BEFORE UPDATE ON panel_explanations
BEGIN
  SELECT RAISE(ABORT, 'panel explanations are never rewritten');
END;
