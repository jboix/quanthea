-- Conversations about a dashboard: a conversation is the chain of questions from a first one, whose
-- parent is NULL. Each question names the first question of its chain, so a conversation is listed,
-- read and searched without walking the chain. A first question names itself.
ALTER TABLE dashboard_questions ADD COLUMN root_id TEXT NOT NULL DEFAULT '';

-- Every stored question gets its root by walking down from the first questions. A follow-up of an
-- earlier, not the last, question of a chain stays in the same conversation.
WITH RECURSIVE chain (id, root_id) AS (
  SELECT id, id FROM dashboard_questions WHERE parent_id IS NULL
  UNION ALL
  SELECT child.id, chain.root_id
  FROM dashboard_questions AS child JOIN chain ON child.parent_id = chain.id
)
UPDATE dashboard_questions
SET root_id = (SELECT chain.root_id FROM chain WHERE chain.id = dashboard_questions.id);

CREATE INDEX dashboard_questions_by_conversation
ON dashboard_questions (dashboard_id, root_id, asked_at);
