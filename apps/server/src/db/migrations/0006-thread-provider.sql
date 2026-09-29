-- The model provider a thread uses. NULL, or a provider that was removed, means the default.
ALTER TABLE threads ADD COLUMN provider_id TEXT;
