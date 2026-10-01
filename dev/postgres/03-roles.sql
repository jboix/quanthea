-- dash_ro: the read-only role the quanthea connector should use. It can read every table and write
-- none, so the connector test reports it as read-only.
CREATE ROLE dash_ro LOGIN PASSWORD 'dash-ro-dev';
GRANT CONNECT ON DATABASE orders TO dash_ro;
GRANT USAGE ON SCHEMA public TO dash_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO dash_ro;
ALTER ROLE dash_ro SET default_transaction_read_only = on;
