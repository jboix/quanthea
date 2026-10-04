-- Everything since v0.2.0, in one step:
-- - snapshot links, and the `snapshot_view` kind in the usage ledger;
-- - the analyst role, between viewer and editor;
-- - questions about a pinned dashboard, in conversations, with their full-text index;
-- - explanations of the panels of a version;
-- - the feature each model step served, in the usage ledger.

-- Snapshot links: a dashboard version frozen with the results its panels showed. The id is the
-- unguessable part of the link (128 random bits). A snapshot goes when its time is up, when someone
-- revokes it, or with its dashboard when the dashboard's thread is purged.
CREATE TABLE snapshots (
  id TEXT PRIMARY KEY,
  dashboard_id TEXT NOT NULL REFERENCES dashboards (id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  title TEXT NOT NULL,
  -- The time range the panels ran over, in epoch milliseconds.
  time_from INTEGER NOT NULL,
  time_to INTEGER NOT NULL,
  -- JSON: the variable values, and the ids of the hidden sets of markers.
  variables TEXT NOT NULL,
  hidden_markers TEXT NOT NULL,
  -- JSON: the version's spec, and each panel's run by panel id.
  spec TEXT NOT NULL,
  panels TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  -- Who took it, for accountability only: it gives them no rights over it.
  taken_by TEXT NOT NULL,
  taken_at INTEGER NOT NULL,
  -- NULL: it lives until someone revokes it.
  expires_at INTEGER
);

CREATE INDEX snapshots_by_dashboard ON snapshots (dashboard_id, taken_at);

CREATE INDEX snapshots_by_expiry ON snapshots (expires_at) WHERE expires_at IS NOT NULL;

-- The usage ledger also counts views of snapshots, and says which feature each model step served,
-- so Settings → Usage can say which one spends what. It is another axis than the job: the answer
-- job serves both questions and panel explanations. Views serve no feature and keep NULL. SQLite
-- changes a CHECK only by building the table again.
CREATE TABLE usage_events_next (
  id TEXT PRIMARY KEY,
  at INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('model', 'pinned_view', 'snapshot_view')),
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
  cost_micros INTEGER,
  feature TEXT CHECK (feature IN ('building', 'question', 'explanation'))
);

-- Before this migration, every model step built dashboards.
INSERT INTO usage_events_next (
  id, at, kind, thread_id, dashboard_id, user_id, provider, model, job,
  input, cached_input, cache_write, output, cost_micros, feature
)
SELECT
  id, at, kind, thread_id, dashboard_id, user_id, provider, model, job,
  input, cached_input, cache_write, output, cost_micros,
  CASE WHEN kind = 'model' THEN 'building' END
FROM usage_events;

DROP TABLE usage_events;

ALTER TABLE usage_events_next RENAME TO usage_events;

CREATE INDEX usage_events_by_time ON usage_events (at);

-- The analyst role, between viewer and editor. `users` is rebuilt the documented way: a new table,
-- the rows copied, the old one dropped, the new one renamed. The runner turns foreign keys off
-- around a migration, so the sessions, password links and identities that refer to users keep
-- their rows, and checks every reference before the commit. `users` has no index or trigger of its
-- own besides its keys.
CREATE TABLE users_next (
  id TEXT PRIMARY KEY,
  email_index BLOB NOT NULL UNIQUE,
  email_sealed BLOB NOT NULL,
  name_sealed BLOB NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('viewer', 'analyst', 'editor', 'admin')),
  -- argon2id over an HMAC of the password with the pepper; NULL until a password is set.
  password_hash TEXT,
  -- Which pepper the hash was made with: the current one, or the one being rotated out.
  pepper_id TEXT,
  -- The default admin quanthea creates on first start signs in with a generated password, and must
  -- choose their own email and password before anything else.
  setup_required INTEGER NOT NULL DEFAULT 0,
  disabled_at INTEGER,
  last_sign_in_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT INTO users_next (
  id, email_index, email_sealed, name_sealed, role, password_hash, pepper_id, setup_required,
  disabled_at, last_sign_in_at, created_at, updated_at
)
SELECT
  id, email_index, email_sealed, name_sealed, role, password_hash, pepper_id, setup_required,
  disabled_at, last_sign_in_at, created_at, updated_at
FROM users;

DROP TABLE users;

ALTER TABLE users_next RENAME TO users;

-- Questions about a pinned dashboard: a shared record of the dashboard, not a thread. Each row keeps
-- the version, the range and the variables as shown, who asked, the question and its outcome. A
-- question goes with its dashboard, as snapshots do. A conversation is the chain of questions from
-- a first one, whose parent is NULL; each question names the first question of its chain, so a
-- conversation is listed, read and searched without walking the chain.
CREATE TABLE dashboard_questions (
  id TEXT PRIMARY KEY,
  dashboard_id TEXT NOT NULL REFERENCES dashboards (id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  -- The question this one follows up on, on the same dashboard.
  parent_id TEXT REFERENCES dashboard_questions (id) ON DELETE CASCADE,
  -- The range shown, in epoch milliseconds, and the time zone the answer names times in.
  time_from INTEGER NOT NULL,
  time_to INTEGER NOT NULL,
  time_zone TEXT NOT NULL,
  -- JSON: the variable values, and the ids of the hidden sets of markers.
  variables TEXT NOT NULL,
  hidden_markers TEXT NOT NULL,
  -- 1 when no source of the dashboard showed numbers, so the answer could only explain.
  explain_only INTEGER NOT NULL CHECK (explain_only IN (0, 1)),
  -- Who asked, for accountability only: it gives them no rights over it.
  asked_by TEXT NOT NULL,
  asked_at INTEGER NOT NULL,
  question TEXT NOT NULL,
  -- The answer's text, or NULL when it failed; then `failure` says why.
  answer TEXT,
  failure TEXT,
  -- JSON: the answer's citations, and every read the model made.
  citations TEXT NOT NULL,
  evidence TEXT NOT NULL,
  -- JSON: the tokens by model, and their sum.
  usage TEXT NOT NULL,
  tokens INTEGER NOT NULL,
  -- The first question of its conversation: a first question names itself.
  root_id TEXT NOT NULL,
  -- The range as chosen when it was asked, JSON: a relative expression such as `now-1h`, or
  -- absolute times.
  time_chosen TEXT NOT NULL,
  CHECK ((answer IS NULL) <> (failure IS NULL))
);

CREATE INDEX dashboard_questions_by_dashboard ON dashboard_questions (dashboard_id, asked_at);

CREATE INDEX dashboard_questions_by_parent ON dashboard_questions (parent_id)
WHERE parent_id IS NOT NULL;

CREATE INDEX dashboard_questions_by_conversation
ON dashboard_questions (dashboard_id, root_id, asked_at);

-- The full-text index of the questions and their answers, for "already answered". Porter stemming
-- lets "errors" find "error".
CREATE VIRTUAL TABLE question_fts USING fts5(
  question_id UNINDEXED,
  dashboard_id UNINDEXED,
  question,
  answer,
  tokenize = 'porter unicode61'
);

-- A question is stored once, with its outcome, and never changed; deleting it, or its dashboard,
-- removes it from the index.
CREATE TRIGGER question_fts_on_insert AFTER INSERT ON dashboard_questions
BEGIN
  INSERT INTO question_fts (question_id, dashboard_id, question, answer)
  VALUES (NEW.id, NEW.dashboard_id, NEW.question, coalesce(NEW.answer, ''));
END;

CREATE TRIGGER question_fts_on_delete AFTER DELETE ON dashboard_questions
BEGIN
  DELETE FROM question_fts WHERE question_id = OLD.id;
END;

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

-- ---------------------------------------------------------------------------------------------
-- Notification channels: where alerts send their messages, and the log of what was sent.
-- ---------------------------------------------------------------------------------------------

-- A channel an admin added. The URL or routing key and any signing secret are sealed together,
-- bound to the channel id; `target_hint` is the masked form the settings show. The code checks the
-- kind, so a new kind needs no table rebuild.
CREATE TABLE notification_channels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  target_hint TEXT NOT NULL,
  -- JSON: the mentions added when an alert starts firing, in the service's syntax.
  mentions TEXT NOT NULL DEFAULT '[]',
  signed INTEGER NOT NULL DEFAULT 0 CHECK (signed IN (0, 1)),
  secret BLOB NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  -- The channel's status: the last message that got through, and the last failure.
  last_sent_at INTEGER,
  last_error_at INTEGER,
  last_error TEXT,
  last_error_status INTEGER
);

-- One message sent to a channel, after its retries. The hourly purge keeps the newest rows of
-- each channel for a while; the rows go with their channel.
CREATE TABLE notification_sends (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES notification_channels (id) ON DELETE CASCADE,
  event TEXT NOT NULL CHECK (event IN ('alert.firing', 'alert.resolved', 'alert.test')),
  alert_id TEXT NOT NULL,
  series_key TEXT NOT NULL,
  at INTEGER NOT NULL,
  ok INTEGER NOT NULL CHECK (ok IN (0, 1)),
  http_status INTEGER,
  attempts INTEGER NOT NULL,
  -- Why it failed, without the target.
  error TEXT
);

CREATE INDEX notification_sends_by_channel ON notification_sends (channel_id, at);
