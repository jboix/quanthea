-- Follows 0003, which shipped in a release: every schema change since goes here.

-- --------------------------------------------------------------------------- quiet hours
-- A change of state, or of whether an alert can be checked, whose message quiet hours held back
-- says so in the alert's history. Earlier rows held nothing back: quiet hours did not exist.
ALTER TABLE alert_events ADD COLUMN quiet INTEGER NOT NULL DEFAULT 0 CHECK (quiet IN (0, 1));

ALTER TABLE alert_check_events ADD COLUMN quiet INTEGER NOT NULL DEFAULT 0
  CHECK (quiet IN (0, 1));
