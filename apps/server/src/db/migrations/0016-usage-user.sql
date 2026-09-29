-- Who each model step ran for: the owner of its thread when the step was recorded, kept after the
-- thread is purged. Steps recorded before are given their thread's owner while it still exists.
ALTER TABLE usage_events ADD COLUMN user_id TEXT;

UPDATE usage_events
SET user_id = (SELECT created_by FROM threads WHERE threads.id = usage_events.thread_id)
WHERE thread_id IS NOT NULL;
