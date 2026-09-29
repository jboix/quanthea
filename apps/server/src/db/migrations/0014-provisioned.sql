-- What the configuration file manages: each item once, the file that declares it, and a keyed
-- hash of what was last applied, so an unchanged item is left alone. `editable` lists the fields
-- the file leaves to the interface. A user is named by the keyed hash of their email.
CREATE TABLE provisioned (
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  fingerprint BLOB NOT NULL,
  editable TEXT NOT NULL DEFAULT '[]',
  applied_at INTEGER NOT NULL,
  PRIMARY KEY (kind, name)
);
