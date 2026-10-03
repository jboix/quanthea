-- The feature each model step served, so Settings → Usage can say which one spends what. It is
-- another axis than the job: the answer job serves both questions and panel explanations. Views
-- serve no feature and keep NULL.
ALTER TABLE usage_events ADD COLUMN feature TEXT
CHECK (feature IN ('building', 'question', 'explanation'));

-- The backfill is a best effort, in three passes.
-- 1. A step in a thread, or of any job but `answer` (such as tags at pin time), built dashboards.
UPDATE usage_events SET feature = 'building'
WHERE kind = 'model' AND (thread_id IS NOT NULL OR job IS NOT 'answer');

-- 2. An answer step explained a panel when the same person started an explanation of the same
-- dashboard in the ten minutes before it, later than any question they asked there. Both are
-- stamped when they start, and the steps follow.
UPDATE usage_events SET feature = 'explanation'
WHERE kind = 'model' AND feature IS NULL
  AND coalesce((
    SELECT max(explained_at) FROM panel_explanations
    WHERE dashboard_id = usage_events.dashboard_id AND explained_by = usage_events.user_id
      AND explained_at BETWEEN usage_events.at - 600000 AND usage_events.at
  ), -1) > coalesce((
    SELECT max(asked_at) FROM dashboard_questions
    WHERE dashboard_id = usage_events.dashboard_id AND asked_by = usage_events.user_id
      AND asked_at BETWEEN usage_events.at - 600000 AND usage_events.at
  ), -1);

-- 3. Every other answer step answered a question. A failed explanation is not stored, so its
-- steps count here.
UPDATE usage_events SET feature = 'question' WHERE kind = 'model' AND feature IS NULL;
