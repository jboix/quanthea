-- Questions about a pinned dashboard: a shared record of the dashboard, not a thread. Each row keeps
-- the version, the range and the variables as shown, who asked, the question and its outcome. A
-- question goes with its dashboard, as snapshots do.
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
  CHECK ((answer IS NULL) <> (failure IS NULL))
);

CREATE INDEX dashboard_questions_by_dashboard ON dashboard_questions (dashboard_id, asked_at);

CREATE INDEX dashboard_questions_by_parent ON dashboard_questions (parent_id)
WHERE parent_id IS NOT NULL;

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
