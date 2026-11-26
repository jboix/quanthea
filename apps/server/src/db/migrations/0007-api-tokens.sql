-- API tokens: a person makes a token so an MCP client can read quanthea as them. Only a keyed
-- hash of the token is stored, so a copy of the database gives no usable token. A token acts as
-- its user with the weaker of its role and the user's, until it expires or is revoked.

CREATE TABLE api_tokens (
  -- A keyed hash of the token; the token itself is shown once, to whoever makes it.
  token_hash BLOB PRIMARY KEY,
  -- Names the token in lists and when revoking it, without giving it away.
  public_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('viewer', 'analyst', 'editor', 'admin')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  -- The last request it signed in, written at most once a minute; NULL until it is used.
  last_used_at INTEGER
);

CREATE INDEX api_tokens_by_user ON api_tokens (user_id);

-- What tokens did: one row per tool call on the MCP endpoint, kept 90 days. A row outlives its
-- token, so it carries the token's name and its user, and it has no foreign key.
CREATE TABLE mcp_calls (
  id TEXT PRIMARY KEY,
  at INTEGER NOT NULL,
  -- The public id and the name of the token the call came with.
  token_id TEXT NOT NULL,
  token_name TEXT NOT NULL,
  user_id TEXT NOT NULL,
  -- The role the call acted with: the weaker of the token's and its owner's then.
  role TEXT NOT NULL,
  -- The tool as the caller named it, and its arguments as JSON, cut at 2,000 characters.
  tool TEXT NOT NULL,
  arguments TEXT NOT NULL,
  -- 'ok', 'refused' (a refusal the caller got as a tool error, or an unknown tool) or 'failed'.
  outcome TEXT NOT NULL CHECK (outcome IN ('ok', 'refused', 'failed')),
  duration_ms INTEGER NOT NULL,
  -- Where the request came from, as the throttle sees it.
  address TEXT NOT NULL
);

CREATE INDEX mcp_calls_by_time ON mcp_calls (at);
