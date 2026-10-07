-- Every column of a dashboard version is immutable but `pinned_at`, which is set once. The trigger
-- of the first schema covered only the spec, the number and the dashboard; this one covers every
-- other column too, as the alert and report versions' triggers do.
DROP TRIGGER versions_are_immutable;

CREATE TRIGGER versions_are_immutable
BEFORE UPDATE OF id, dashboard_id, version, spec, change_summary, actor, created_at
ON dashboard_versions
BEGIN
  SELECT RAISE(ABORT, 'dashboard versions are immutable');
END;

-- A layout is how one version of a dashboard is shown: each panel's place, size and whether it is
-- hidden, as JSON. It never changes the version. Saving adds a revision and the latest is shown;
-- restoring an earlier one adds a revision that copies it.
CREATE TABLE dashboard_layouts (
  id TEXT PRIMARY KEY,
  dashboard_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  layout TEXT NOT NULL,
  restored_from INTEGER,
  actor TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (dashboard_id, version, revision),
  FOREIGN KEY (dashboard_id, version)
    REFERENCES dashboard_versions (dashboard_id, version) ON DELETE CASCADE
);

-- Layout revisions are never rewritten.
CREATE TRIGGER layouts_are_immutable
BEFORE UPDATE ON dashboard_layouts
BEGIN
  SELECT RAISE(ABORT, 'dashboard layouts are immutable');
END;
