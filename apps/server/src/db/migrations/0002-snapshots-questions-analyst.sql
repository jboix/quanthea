-- Everything since v0.2.0, in one step:
-- - snapshot links, and the `snapshot_view` kind in the usage ledger;
-- - the analyst role, between viewer and editor;
-- - questions about a pinned dashboard, in conversations, with their full-text index and their bin;
-- - explanations of the panels of a version;
-- - the feature each model step served, and the vendor it reached, in the usage ledger.
-- - alerts, their versions, the state of their series and what happened to them.
-- - what a thread makes, a dashboard or an alert, and the panel an alert thread starts from.
-- - reports, their versions and their runs.

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
  -- The provider's name, as configured.
  provider TEXT,
  -- Who the step's requests reached, such as `gemini`, from the provider's kind and base URL. NULL
  -- for views, and for steps recorded before it was kept: their provider names no vendor.
  vendor TEXT,
  model TEXT,
  job TEXT,
  input INTEGER NOT NULL DEFAULT 0,
  cached_input INTEGER NOT NULL DEFAULT 0,
  cache_write INTEGER NOT NULL DEFAULT 0,
  output INTEGER NOT NULL DEFAULT 0,
  -- The list price at the time, in millionths of a dollar; NULL when the model had no price.
  cost_micros INTEGER,
  feature TEXT CHECK (feature IN ('building', 'question', 'explanation', 'alert'))
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

-- The conversations in the bin, by their first question. A row of its own keeps the questions
-- stored once and never changed: binning adds a row, restoring removes it. Every read of the
-- questions skips a binned conversation. Purging deletes its questions, and this row with its
-- first question.
CREATE TABLE conversation_bin (
  conversation_id TEXT PRIMARY KEY REFERENCES dashboard_questions (id) ON DELETE CASCADE,
  binned_by TEXT NOT NULL,
  binned_at INTEGER NOT NULL
);

CREATE INDEX conversation_bin_by_time ON conversation_bin (binned_at);

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
-- each channel for a while; the rows go with their channel. A report's message names its report
-- and, as its series key, its run; its `alert_id` is empty.
CREATE TABLE notification_sends (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES notification_channels (id) ON DELETE CASCADE,
  event TEXT NOT NULL CHECK (
    event IN (
      'alert.firing', 'alert.resolved', 'alert.test', 'alert.error', 'alert.recovered',
      'report.ready', 'report.failed'
    )
  ),
  alert_id TEXT NOT NULL,
  report_id TEXT,
  series_key TEXT NOT NULL,
  at INTEGER NOT NULL,
  ok INTEGER NOT NULL CHECK (ok IN (0, 1)),
  http_status INTEGER,
  attempts INTEGER NOT NULL,
  -- Why it failed, without the target.
  error TEXT
);

CREATE INDEX notification_sends_by_channel ON notification_sends (channel_id, at);
-- ---------------------------------------------------------------------------------------- alerts
-- Alerts: a query, a condition and a message, evaluated by the server with no model. Like
-- dashboards they have versions that are never rewritten; one version at a time is active.
-- Deactivating stops evaluation and keeps the active version. Muting stops notifications only:
-- evaluation and state go on. `muted_until` NULL with `muted_at` set mutes until someone unmutes.
CREATE TABLE alerts (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  -- The conversation that made it, if any; the alert outlives a purged thread.
  thread_id TEXT REFERENCES threads (id) ON DELETE SET NULL,
  active_version INTEGER,
  deactivated_at INTEGER,
  muted_at INTEGER,
  muted_by TEXT,
  muted_until INTEGER,
  -- When it was last evaluated, so the evaluator knows when it is due.
  evaluated_at INTEGER,
  -- Whether it can be checked: the evaluations in a row whose query failed, when it went into
  -- error after a few of them (NULL while it can be checked), and whether that was announced.
  failed_checks INTEGER NOT NULL DEFAULT 0,
  check_error_since INTEGER,
  check_error_notified INTEGER NOT NULL DEFAULT 0 CHECK (check_error_notified IN (0, 1)),
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (id, active_version) REFERENCES alert_versions (alert_id, version),
  CHECK ((muted_at IS NULL) = (muted_by IS NULL)),
  CHECK (muted_until IS NULL OR muted_at IS NOT NULL)
);

CREATE INDEX alerts_evaluated ON alerts (active_version)
WHERE active_version IS NOT NULL AND deactivated_at IS NULL;

CREATE INDEX alerts_by_thread ON alerts (thread_id) WHERE thread_id IS NOT NULL;

-- The versions of an alert, numbered from 1. `activated_at` is when a version was first active.
CREATE TABLE alert_versions (
  alert_id TEXT NOT NULL REFERENCES alerts (id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  -- JSON: the alert spec.
  spec TEXT NOT NULL,
  note TEXT,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  activated_at INTEGER,
  PRIMARY KEY (alert_id, version)
);

-- Every version is immutable, whatever the application code does.
CREATE TRIGGER alert_versions_are_immutable
BEFORE UPDATE OF alert_id, version, spec, note, created_by, created_at ON alert_versions
BEGIN
  SELECT RAISE(ABORT, 'alert versions are immutable');
END;

-- A version keeps the time it was first activated.
CREATE TRIGGER alert_first_activation_is_kept
BEFORE UPDATE OF activated_at ON alert_versions
WHEN OLD.activated_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'a version keeps the time it was first activated');
END;

-- The state of each series of an alert, as the last evaluation left it. The key is the series'
-- labels written in order; the empty key stands for the alert as a whole.
CREATE TABLE alert_series (
  alert_id TEXT NOT NULL REFERENCES alerts (id) ON DELETE CASCADE,
  series_key TEXT NOT NULL,
  -- JSON: the labels.
  labels TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('ok', 'pending', 'firing', 'no_data', 'error')),
  -- When it entered its state.
  since INTEGER NOT NULL,
  value REAL,
  -- When the result last held it: a series left out resolves after a grace period.
  last_seen_at INTEGER NOT NULL,
  evaluated_at INTEGER NOT NULL,
  notified_at INTEGER,
  -- 1 once it announced firing, until it announces resolving.
  announced INTEGER NOT NULL DEFAULT 0 CHECK (announced IN (0, 1)),
  PRIMARY KEY (alert_id, series_key)
);

-- What happened: each change of state of a series, kept 90 days by the purge job.
CREATE TABLE alert_events (
  id TEXT PRIMARY KEY,
  alert_id TEXT NOT NULL REFERENCES alerts (id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  series_key TEXT NOT NULL,
  labels TEXT NOT NULL,
  from_state TEXT NOT NULL CHECK (from_state IN ('ok', 'pending', 'firing', 'no_data', 'error')),
  to_state TEXT NOT NULL CHECK (to_state IN ('ok', 'pending', 'firing', 'no_data', 'error')),
  at INTEGER NOT NULL,
  value REAL,
  -- Why the query failed, for a change to `error`.
  message TEXT,
  -- 1 when the change sent a notification.
  notified INTEGER NOT NULL DEFAULT 0 CHECK (notified IN (0, 1))
);

CREATE INDEX alert_events_by_alert ON alert_events (alert_id, at);

CREATE INDEX alert_events_by_time ON alert_events (at);

-- What happened to whether an alert can be checked: it went into error, or can be checked again.
-- Kept 90 days by the purge job, like the changes of state.
CREATE TABLE alert_check_events (
  id TEXT PRIMARY KEY,
  alert_id TEXT NOT NULL REFERENCES alerts (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('error', 'recovered')),
  at INTEGER NOT NULL,
  -- Why the query failed, for `error`.
  reason TEXT,
  -- 1 when it sent a notification.
  notified INTEGER NOT NULL DEFAULT 0 CHECK (notified IN (0, 1))
);

CREATE INDEX alert_check_events_by_alert ON alert_check_events (alert_id, at);

CREATE INDEX alert_check_events_by_time ON alert_check_events (at);

-- --------------------------------------------------------------------------- alert conversations
-- A thread makes a dashboard or an alert, chosen when it starts and fixed. An alert thread may
-- start from a panel of a dashboard version; `seed` names it, as JSON
-- `{"dashboardId", "version", "panelId"}`, and the agent reads that panel's query and title.
ALTER TABLE threads ADD COLUMN kind TEXT NOT NULL DEFAULT 'dashboard'
  CHECK (kind IN ('dashboard', 'alert'));

ALTER TABLE threads ADD COLUMN seed TEXT;

-- --------------------------------------------------------------------------- alerts on panels
-- A link says an alert watches what a dashboard panel shows. It names the panel by id, not a
-- version, so it follows the panel from version to version. It goes with either side.
CREATE TABLE alert_links (
  alert_id TEXT NOT NULL REFERENCES alerts (id) ON DELETE CASCADE,
  dashboard_id TEXT NOT NULL REFERENCES dashboards (id) ON DELETE CASCADE,
  panel_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  -- How it was made: from the panel, from the agent's card, by hand, or from a matching query.
  how TEXT NOT NULL CHECK (how IN ('from_panel', 'agent', 'by_hand', 'query_match')),
  PRIMARY KEY (alert_id, dashboard_id, panel_id)
);

CREATE INDEX alert_links_by_dashboard ON alert_links (dashboard_id);

-- A suggestion an editor dismissed: an alert and a panel whose queries match. It is not
-- suggested again, and it goes with either side.
CREATE TABLE alert_link_dismissals (
  alert_id TEXT NOT NULL REFERENCES alerts (id) ON DELETE CASCADE,
  dashboard_id TEXT NOT NULL REFERENCES dashboards (id) ON DELETE CASCADE,
  panel_id TEXT NOT NULL,
  dismissed_by TEXT NOT NULL,
  dismissed_at INTEGER NOT NULL,
  PRIMARY KEY (alert_id, dashboard_id, panel_id)
);

CREATE INDEX alert_link_dismissals_by_dashboard ON alert_link_dismissals (dashboard_id);

-- --------------------------------------------------------------------------------------- reports
-- Reports: a dashboard spec's panels run on a schedule over a period, with no model. Like alerts
-- they have versions that are never rewritten, and one version at a time is active. Deactivating
-- stops the schedule and keeps the active version and the runs. `next_run_at` is when the active
-- version's schedule runs next; NULL while the report is not active. A report outlives a purged
-- thread. The notification log's `report_id` and its report events, in `notification_sends`
-- above, belong to reports too.
CREATE TABLE reports (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  thread_id TEXT REFERENCES threads (id) ON DELETE SET NULL,
  active_version INTEGER,
  deactivated_at INTEGER,
  next_run_at INTEGER,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (id, active_version) REFERENCES report_versions (report_id, version)
);

CREATE INDEX reports_due ON reports (next_run_at)
WHERE active_version IS NOT NULL AND deactivated_at IS NULL;

CREATE INDEX reports_by_thread ON reports (thread_id) WHERE thread_id IS NOT NULL;

-- The versions of a report, numbered from 1. `activated_at` is when a version was first active.
CREATE TABLE report_versions (
  report_id TEXT NOT NULL REFERENCES reports (id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  -- JSON: the report spec.
  spec TEXT NOT NULL,
  note TEXT,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  activated_at INTEGER,
  PRIMARY KEY (report_id, version)
);

-- Every version is immutable, whatever the application code does.
CREATE TRIGGER report_versions_are_immutable
BEFORE UPDATE OF report_id, version, spec, note, created_by, created_at ON report_versions
BEGIN
  SELECT RAISE(ABORT, 'report versions are immutable');
END;

-- A version keeps the time it was first activated.
CREATE TRIGGER report_first_activation_is_kept
BEFORE UPDATE OF activated_at ON report_versions
WHEN OLD.activated_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'a version keeps the time it was first activated');
END;

-- A run: one version's panels over one period, and over the period before, frozen as a snapshot
-- freezes them (each panel's run by panel id, as `POST /api/panels/run` returns it). A run is
-- `running` until it succeeds or fails after its retries; `retry_at` is when a failed attempt tries
-- again. The schedule makes one run per scheduled time. The hourly purge deletes runs past the
-- retention setting; the report and its versions stay.
CREATE TABLE report_runs (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES reports (id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('schedule', 'manual')),
  -- The schedule's time it ran for; NULL for a run by hand.
  scheduled_at INTEGER,
  -- The period and the period it compares with, in epoch milliseconds, both ends included.
  period_from INTEGER NOT NULL,
  period_to INTEGER NOT NULL,
  compare_from INTEGER,
  compare_to INTEGER,
  status TEXT NOT NULL CHECK (status IN ('running', 'ok', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  retry_at INTEGER,
  -- Why the last attempt failed, in words that quote no secret.
  error TEXT,
  -- JSON: the variable values, each panel's run, and the headline numbers.
  variables TEXT NOT NULL,
  panels TEXT,
  comparison TEXT,
  headlines TEXT NOT NULL DEFAULT '[]',
  bytes INTEGER NOT NULL DEFAULT 0,
  -- 1 when its outcome goes to the channels: every scheduled run, and a run by hand when asked.
  notify INTEGER NOT NULL CHECK (notify IN (0, 1)),
  -- Who ran it by hand; NULL for the schedule.
  started_by TEXT,
  created_at INTEGER NOT NULL,
  ran_at INTEGER,
  -- When its message went out, and each channel's result, as JSON.
  sent_at INTEGER,
  delivery TEXT,
  FOREIGN KEY (report_id, version) REFERENCES report_versions (report_id, version),
  CHECK ((compare_from IS NULL) = (compare_to IS NULL)),
  CHECK ((kind = 'schedule') = (scheduled_at IS NOT NULL))
);

CREATE INDEX report_runs_by_report ON report_runs (report_id, period_from);

CREATE INDEX report_runs_running ON report_runs (retry_at) WHERE status = 'running';

CREATE INDEX report_runs_by_time ON report_runs (created_at);

CREATE UNIQUE INDEX report_runs_once_per_schedule ON report_runs (report_id, scheduled_at)
WHERE kind = 'schedule';

-- A finished run is never rewritten: only a running run changes.
CREATE TRIGGER report_runs_are_kept
BEFORE UPDATE OF id, report_id, version, kind, scheduled_at, period_from, period_to,
  compare_from, compare_to, status, attempts, retry_at, error, variables, panels, comparison,
  headlines, bytes, notify, started_by, created_at, ran_at ON report_runs
WHEN OLD.status <> 'running'
BEGIN
  SELECT RAISE(ABORT, 'a finished report run is never rewritten');
END;

-- A run records once when its message went out.
CREATE TRIGGER report_runs_send_once
BEFORE UPDATE OF sent_at, delivery ON report_runs
WHEN OLD.sent_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'a report run records its message once');
END;
