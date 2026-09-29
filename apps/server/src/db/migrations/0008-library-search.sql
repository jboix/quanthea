-- What the library searches: one document for each pinned dashboard outside the bin, and one for
-- each of its panels. A panel's context holds its dashboard's title and tags, and a dashboard's
-- context holds its panels' titles, so a search can match words spread over both.
CREATE VIEW library_documents AS
SELECT
  d.id AS dashboard_id,
  NULL AS panel_id,
  d.title AS title,
  coalesce(d.description, '') AS description,
  (SELECT coalesce(group_concat(tag.value, ' '), '') FROM json_each(d.tags) AS tag) AS tags,
  '' AS queries,
  (
    SELECT coalesce(group_concat(json_extract(panel.value, '$.title'), ' '), '')
    FROM json_each(v.spec, '$.panels') AS panel
  ) AS context
FROM dashboards AS d
JOIN dashboard_versions AS v ON v.id = d.pinned_version_id
WHERE d.deleted_at IS NULL
UNION ALL
SELECT
  d.id,
  json_extract(panel.value, '$.id'),
  json_extract(panel.value, '$.title'),
  coalesce(json_extract(panel.value, '$.description'), ''),
  '',
  (
    SELECT coalesce(group_concat(
      json_extract(query.value, '$.connector') || ' '
        || coalesce(json_extract(query.value, '$.expr'), json_extract(query.value, '$.sql'), ''),
      ' '), '')
    FROM json_each(panel.value, '$.queries') AS query
  ),
  d.title || ' ' || (SELECT coalesce(group_concat(tag.value, ' '), '') FROM json_each(d.tags) AS tag)
FROM dashboards AS d
JOIN dashboard_versions AS v ON v.id = d.pinned_version_id
JOIN json_each(v.spec, '$.panels') AS panel
WHERE d.deleted_at IS NULL;

-- The full-text index of those documents. Porter stemming lets "errors" find "error".
CREATE VIRTUAL TABLE library_fts USING fts5(
  dashboard_id UNINDEXED,
  panel_id UNINDEXED,
  title,
  description,
  tags,
  queries,
  context,
  tokenize = 'porter unicode61'
);

INSERT INTO library_fts SELECT * FROM library_documents;

-- Pinning, renaming, binning and restoring change a dashboard's documents; deleting removes them.
CREATE TRIGGER library_fts_on_update
AFTER UPDATE OF pinned_version_id, title, description, tags, deleted_at ON dashboards
BEGIN
  DELETE FROM library_fts WHERE dashboard_id = NEW.id;
  INSERT INTO library_fts SELECT * FROM library_documents WHERE dashboard_id = NEW.id;
END;

CREATE TRIGGER library_fts_on_delete AFTER DELETE ON dashboards
BEGIN
  DELETE FROM library_fts WHERE dashboard_id = OLD.id;
END;
