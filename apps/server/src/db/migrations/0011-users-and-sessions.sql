-- People who sign in, and their sessions. A stolen database gives nothing usable: names and
-- emails are sealed with the secret key, an email is found through a keyed hash of its normalised
-- form, and a session is stored only as a keyed hash of its id.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email_index BLOB NOT NULL UNIQUE,
  email_sealed BLOB NOT NULL,
  name_sealed BLOB NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('viewer', 'editor', 'admin')),
  -- argon2id over an HMAC of the password with the pepper; NULL until a password is set.
  password_hash TEXT,
  -- Which pepper the hash was made with: the current one, or the one being rotated out.
  pepper_id TEXT,
  disabled_at INTEGER,
  last_sign_in_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  -- A keyed hash of the session id; the id itself exists only in the browser's cookie.
  id_hash BLOB PRIMARY KEY,
  -- Names the session in lists and when revoking it, without giving it away.
  public_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  -- The absolute end; the idle end is last_seen_at plus the idle limit.
  expires_at INTEGER NOT NULL
);

CREATE INDEX sessions_by_user ON sessions (user_id);
