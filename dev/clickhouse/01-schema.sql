-- The orders database of the dev environment, for ClickHouse: the same shop and incident as
-- dev/postgres and dev/mysql. Times are UTC.

CREATE TABLE orders.customers (
  id UInt64,
  email String,
  name String,
  country LowCardinality(String),
  created_at DateTime('UTC')
) ENGINE = MergeTree ORDER BY id
COMMENT 'Shop customers. email is personal data.';

CREATE TABLE orders.orders (
  id UInt64,
  customer_id UInt64,
  status LowCardinality(String),
  failure_reason Nullable(String),
  total_cents UInt32,
  total Decimal(10, 2) COMMENT 'The total in francs.',
  currency LowCardinality(String),
  service LowCardinality(String),
  created_at DateTime64(3, 'UTC')
) ENGINE = MergeTree ORDER BY (created_at, id)
COMMENT 'One row per order attempt, including failed ones.';

CREATE TABLE orders.deploys (
  id UInt64,
  service LowCardinality(String),
  version String,
  deployed_at DateTime('UTC'),
  author LowCardinality(String)
) ENGINE = MergeTree ORDER BY id
COMMENT 'One row per production deploy. Good for chart markers.';

CREATE VIEW orders.failed_orders AS
SELECT id, status, failure_reason, created_at FROM orders.orders WHERE status = 'failed';
