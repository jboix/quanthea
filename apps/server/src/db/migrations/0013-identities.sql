-- A person's accounts at sign-in providers, linked to their querent user. A provider's subject is
-- found through a keyed hash, and kept sealed, so the database holds no readable provider id.
CREATE TABLE identities (
  provider_id TEXT NOT NULL,
  subject_index BLOB NOT NULL,
  subject_sealed BLOB NOT NULL,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  PRIMARY KEY (provider_id, subject_index)
);

CREATE INDEX identities_by_user ON identities (user_id);
