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
