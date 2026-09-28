-- Threads: a conversation that authors one dashboard. The state machine lives in threads/; the
-- CHECK keeps a stray write from storing a state it does not know.
CREATE TABLE threads (
  id TEXT PRIMARY KEY,
  title TEXT,
  state TEXT NOT NULL DEFAULT 'idle'
    CHECK (state IN ('idle', 'plan_pending', 'building', 'ready')),
  dashboard_id TEXT REFERENCES dashboards (id) ON DELETE SET NULL,
  tokens_used INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

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
