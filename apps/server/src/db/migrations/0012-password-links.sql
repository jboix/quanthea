-- One-time links that let a person set a password: an invite for a new user, or a reset. Only a
-- keyed hash of the token is stored; the token itself is in the link, after the `#`, so it never
-- reaches a server log.
CREATE TABLE password_links (
  token_hash BLOB PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('invite', 'reset')),
  expires_at INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX password_links_by_user ON password_links (user_id);
