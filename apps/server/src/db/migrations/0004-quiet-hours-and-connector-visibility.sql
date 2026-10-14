-- Follows 0003, which shipped in a release: every schema change since goes here.

-- --------------------------------------------------------------------------- quiet hours
-- A change of state, or of whether an alert can be checked, whose message quiet hours held back
-- says so in the alert's history. Earlier rows held nothing back: quiet hours did not exist.
ALTER TABLE alert_events ADD COLUMN quiet INTEGER NOT NULL DEFAULT 0 CHECK (quiet IN (0, 1));

ALTER TABLE alert_check_events ADD COLUMN quiet INTEGER NOT NULL DEFAULT 0
  CHECK (quiet IN (0, 1));

-- --------------------------------------------------------------- connector visibility
-- Which objects of its source a connector shows, as JSON: whether the source's own objects are
-- shown, and a list of names that are hidden (`except`) or the only ones shown (`only`). An
-- empty object is the default: system objects hidden, everything else shown.
ALTER TABLE connectors ADD COLUMN visibility TEXT NOT NULL DEFAULT '{}';

-- A connector of an earlier release showed its source's own objects, and its dashboards, alerts
-- and reports may read them. It keeps showing them; a connector made from now on hides them.
UPDATE connectors SET visibility = '{"showSystem":true}';

-- ------------------------------------------------------------- connector bucket scripts
-- Whether a search on the connector may hold a script of its own in `bucket_script` and
-- `bucket_selector`. Off for every connector there is and every new one, until an admin allows it.
ALTER TABLE connectors ADD COLUMN bucket_scripts INTEGER NOT NULL DEFAULT 0
  CHECK (bucket_scripts IN (0, 1));

-- ------------------------------------------------------------------------ report layouts
-- A layout is how one version of a report is shown: the place and size of each panel of its grid
-- and whether it is hidden, as JSON. It never changes the version. Saving adds a revision and the
-- latest is shown; restoring an earlier one adds a revision that copies it. The same shape as
-- `dashboard_layouts`.
CREATE TABLE report_layouts (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  layout TEXT NOT NULL,
  restored_from INTEGER,
  actor TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (report_id, version, revision),
  FOREIGN KEY (report_id, version)
    REFERENCES report_versions (report_id, version) ON DELETE CASCADE
);

-- Layout revisions are never rewritten.
CREATE TRIGGER report_layouts_are_immutable
BEFORE UPDATE ON report_layouts
BEGIN
  SELECT RAISE(ABORT, 'report layouts are immutable');
END;

-- ------------------------------------------------------------------------ definitions
-- A definition gives a business term one meaning: a sentence the agent reads, and checked bodies
-- a panel copies when it is built, as JSON. Each save adds a version and the latest is the one
-- used; a deletion adds a version that says so. Panels keep the copy they made, so no version is
-- ever read back to change one.
CREATE TABLE definition_versions (
  definition_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  definition TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
  origin TEXT NOT NULL CHECK (origin IN ('ui', 'file')),
  actor TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (definition_id, version)
);

-- Definition versions are never rewritten or removed.
CREATE TRIGGER definition_versions_are_immutable
BEFORE UPDATE ON definition_versions
BEGIN
  SELECT RAISE(ABORT, 'definition versions are immutable');
END;

CREATE TRIGGER definition_versions_are_kept
BEFORE DELETE ON definition_versions
BEGIN
  SELECT RAISE(ABORT, 'definition versions are kept');
END;
