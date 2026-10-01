-- Typed key/value settings. Values are JSON, validated by settings/ on read and write.
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Who did what, for accountability. Never used to grant or deny anything.
CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  at INTEGER NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  detail TEXT
);

-- Configured connectors. config and the JSON columns are validated by the application; secret is
-- the AES-GCM sealed credentials, bound to the connector id.
CREATE TABLE connectors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  config TEXT NOT NULL,
  secret BLOB NOT NULL,
  access_level INTEGER NOT NULL DEFAULT 2 CHECK (access_level BETWEEN 1 AND 4),
  hidden_fields TEXT NOT NULL DEFAULT '[]',
  guardrails TEXT NOT NULL,
  descriptions TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- The last schema snapshot read from each connector.
CREATE TABLE schema_cache (
  connector_id TEXT PRIMARY KEY REFERENCES connectors (id) ON DELETE CASCADE,
  snapshot TEXT NOT NULL,
  read_at INTEGER NOT NULL
);

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

-- Every version is immutable: a dashboard changes by adding versions, and pinning chooses the one
-- shown. A version keeps the time it was first pinned.
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

-- Threads: a conversation that authors one dashboard. The state machine lives in threads/; the
-- CHECK keeps a stray write from storing a state it does not know. The bin holds threads: a binned
-- thread keeps its messages, plans and dashboard until it is restored or purged, and purging
-- deletes the thread and its dashboard with every version.
CREATE TABLE threads (
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
  updated_at INTEGER NOT NULL
);

CREATE INDEX threads_in_bin ON threads (deleted_at) WHERE deleted_at IS NOT NULL;

-- The thread's UI messages, in order. parts and metadata are the AI SDK message JSON.
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES threads (id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  role TEXT NOT NULL,
  parts TEXT NOT NULL,
  metadata TEXT,
  actor TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX messages_by_thread ON messages (thread_id, position);

-- Plans the model proposed, and what became of them.
CREATE TABLE plans (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES threads (id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'superseded')),
  decided_by TEXT,
  created_at INTEGER NOT NULL,
  decided_at INTEGER
);

CREATE INDEX plans_by_thread ON plans (thread_id, created_at);

-- The usage ledger: what each model step spent, and each view of a pinned dashboard. No foreign
-- keys: the ledger outlives the threads and dashboards it names.
CREATE TABLE usage_events (
  id TEXT PRIMARY KEY,
  at INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('model', 'pinned_view')),
  thread_id TEXT,
  dashboard_id TEXT,
  -- Who the model step ran for: the owner of its thread, kept after the thread is purged.
  user_id TEXT,
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

-- People who sign in, and their sessions. A stolen database gives nothing usable: names and
-- emails are sealed with the secret key, an email is found through a keyed hash of its normalised
-- form, and a session is stored only as a keyed hash of its id.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email_index BLOB NOT NULL UNIQUE,
  email_sealed BLOB NOT NULL,
  name_sealed BLOB NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('viewer', 'editor', 'admin')),
  -- argon2id over an HMAC of the password with the pepper; NULL until a password is set.
  password_hash TEXT,
  -- Which pepper the hash was made with: the current one, or the one being rotated out.
  pepper_id TEXT,
  -- The default admin querent creates on first start signs in with a generated password, and must
  -- choose their own email and password before anything else.
  setup_required INTEGER NOT NULL DEFAULT 0,
  disabled_at INTEGER,
  last_sign_in_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  -- A keyed hash of the session id; the id itself exists only in the browser's cookie.
  id_hash BLOB PRIMARY KEY,
  -- Names the session in lists and when revoking it, without giving it away.
  public_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  -- The absolute end; the idle end is last_seen_at plus the idle limit.
  expires_at INTEGER NOT NULL
);

CREATE INDEX sessions_by_user ON sessions (user_id);

-- One-time links that let a person set a password: an invite for a new user, or a reset. Only a
-- keyed hash of the token is stored; the token itself is in the link, after the `#`, so it never
-- reaches a server log.
CREATE TABLE password_links (
  token_hash BLOB PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('invite', 'reset')),
  expires_at INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX password_links_by_user ON password_links (user_id);

-- A person's accounts at sign-in providers, linked to their querent user. A provider's subject is
-- found through a keyed hash, and kept sealed, so the database holds no readable provider id.
CREATE TABLE identities (
  provider_id TEXT NOT NULL,
  subject_index BLOB NOT NULL,
  subject_sealed BLOB NOT NULL,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  PRIMARY KEY (provider_id, subject_index)
);

CREATE INDEX identities_by_user ON identities (user_id);

-- What the configuration file manages: each item once, the file that declares it, and a keyed
-- hash of what was last applied, so an unchanged item is left alone. `editable` lists the fields
-- the file leaves to the interface. A user is named by the keyed hash of their email.
CREATE TABLE provisioned (
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  fingerprint BLOB NOT NULL,
  editable TEXT NOT NULL DEFAULT '[]',
  applied_at INTEGER NOT NULL,
  PRIMARY KEY (kind, name)
);

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
        || coalesce(
          json_extract(query.value, '$.expr'),
          json_extract(query.value, '$.sql'),
          json_extract(query.value, '$.index') || ' ' || json_extract(query.value, '$.body'),
          json_extract(query.value, '$.collection') || ' ' || json_extract(query.value, '$.pipeline'),
          ''
        ),
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
