-- ------------------------------------------------------------------------ definitions
-- A definition gives a business term one meaning: a sentence the agent reads, and checked bodies
-- a panel copies when it is built, as JSON. Each save adds a version and the latest is the one
-- used; a deletion adds a version that says so. Panels keep the copy they made, so no version is
-- ever read back to change one.
-- 1.1.0 shipped these in its 0004 by mistake, so a database that ran that file has them already:
-- each statement is IF NOT EXISTS and leaves such a database as it is.
CREATE TABLE IF NOT EXISTS definition_versions (
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
CREATE TRIGGER IF NOT EXISTS definition_versions_are_immutable
BEFORE UPDATE ON definition_versions
BEGIN
  SELECT RAISE(ABORT, 'definition versions are immutable');
END;

CREATE TRIGGER IF NOT EXISTS definition_versions_are_kept
BEFORE DELETE ON definition_versions
BEGIN
  SELECT RAISE(ABORT, 'definition versions are kept');
END;
