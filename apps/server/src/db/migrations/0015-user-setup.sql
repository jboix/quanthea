-- The default admin querent creates on first start signs in with a generated password, and must
-- choose their own email and password before anything else.
ALTER TABLE users ADD COLUMN setup_required INTEGER NOT NULL DEFAULT 0;
