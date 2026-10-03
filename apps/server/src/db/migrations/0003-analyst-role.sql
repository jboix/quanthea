-- The analyst role, between viewer and editor. SQLite changes a CHECK only by building the table
-- again, so `users` is rebuilt the documented way: a new table, the rows copied, the old one
-- dropped, the new one renamed. The runner turns foreign keys off around a migration, so the
-- sessions, password links and identities that refer to users keep their rows, and checks every
-- reference before the commit. `users` has no index or trigger of its own besides its keys.
CREATE TABLE users_next (
  id TEXT PRIMARY KEY,
  email_index BLOB NOT NULL UNIQUE,
  email_sealed BLOB NOT NULL,
  name_sealed BLOB NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('viewer', 'analyst', 'editor', 'admin')),
  -- argon2id over an HMAC of the password with the pepper; NULL until a password is set.
  password_hash TEXT,
  -- Which pepper the hash was made with: the current one, or the one being rotated out.
  pepper_id TEXT,
  -- The default admin quanthea creates on first start signs in with a generated password, and must
  -- choose their own email and password before anything else.
  setup_required INTEGER NOT NULL DEFAULT 0,
  disabled_at INTEGER,
  last_sign_in_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT INTO users_next (
  id, email_index, email_sealed, name_sealed, role, password_hash, pepper_id, setup_required,
  disabled_at, last_sign_in_at, created_at, updated_at
)
SELECT
  id, email_index, email_sealed, name_sealed, role, password_hash, pepper_id, setup_required,
  disabled_at, last_sign_in_at, created_at, updated_at
FROM users;

DROP TABLE users;

ALTER TABLE users_next RENAME TO users;
