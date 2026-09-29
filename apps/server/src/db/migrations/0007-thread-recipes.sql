-- The recipes a thread uses, as JSON: {"mode":"default"}, {"mode":"chosen","ids":[...]} or
-- {"mode":"free"}. NULL means the default set.
ALTER TABLE threads ADD COLUMN recipes TEXT;
