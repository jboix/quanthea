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
