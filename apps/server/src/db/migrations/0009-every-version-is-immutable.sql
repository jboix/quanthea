-- Every version is immutable, not only pinned ones: a dashboard changes by adding versions, and
-- pinning chooses the one shown. A version keeps the time it was first pinned.
DROP TRIGGER pinned_versions_are_immutable;

CREATE TRIGGER versions_are_immutable
BEFORE UPDATE OF spec, version, dashboard_id ON dashboard_versions
BEGIN
  SELECT RAISE(ABORT, 'dashboard versions are immutable');
END;

CREATE TRIGGER first_pin_is_kept
BEFORE UPDATE OF pinned_at ON dashboard_versions
WHEN OLD.pinned_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'a version keeps the time it was first pinned');
END;
