-- The bin holds threads. A binned thread keeps its messages, plans and dashboard until it is
-- restored or purged; purging deletes the thread and its dashboard with every version.
ALTER TABLE threads ADD COLUMN deleted_at INTEGER;
ALTER TABLE threads ADD COLUMN deleted_by TEXT;

CREATE INDEX threads_in_bin ON threads (deleted_at) WHERE deleted_at IS NOT NULL;
