-- TimescaleDB on top of the orders database: the order attempts again as a hypertable, partitioned
-- by hour, and a continuous aggregate of them per minute. dash_ro reads both and writes neither.

CREATE TABLE order_events (
  created_at timestamptz NOT NULL,
  status text NOT NULL,
  failure_reason text,
  total_cents integer NOT NULL,
  service text NOT NULL
);
COMMENT ON TABLE order_events IS 'The order attempts, as a hypertable partitioned by time.';

SELECT create_hypertable('order_events', by_range('created_at', INTERVAL '1 hour'));

INSERT INTO order_events (created_at, status, failure_reason, total_cents, service)
SELECT created_at, status, failure_reason, total_cents, service FROM orders;

CREATE MATERIALIZED VIEW orders_per_minute WITH (timescaledb.continuous) AS
SELECT time_bucket(INTERVAL '1 minute', created_at) AS minute, status, count(*) AS attempts,
  sum(total_cents) AS total_cents
FROM order_events
GROUP BY 1, 2
WITH DATA;

GRANT SELECT ON order_events, orders_per_minute TO dash_ro;

ANALYZE order_events;
