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
