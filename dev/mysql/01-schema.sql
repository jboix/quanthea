-- The orders database of the dev environment, for MySQL and MariaDB: the same shop and incident as
-- dev/postgres, smaller. Times are UTC.

CREATE TABLE customers (
  id bigint AUTO_INCREMENT PRIMARY KEY,
  email varchar(120) NOT NULL,
  name varchar(120) NOT NULL,
  country char(2) NOT NULL,
  created_at datetime NOT NULL
) COMMENT = 'Shop customers. email is personal data.';

CREATE TABLE orders (
  id bigint AUTO_INCREMENT PRIMARY KEY,
  customer_id bigint NOT NULL,
  status varchar(16) NOT NULL,
  failure_reason varchar(40),
  total_cents int NOT NULL,
  total decimal(10, 2) NOT NULL COMMENT 'The total in francs.',
  currency char(3) NOT NULL,
  service varchar(40) NOT NULL,
  created_at datetime(3) NOT NULL,
  INDEX orders_created_at (created_at),
  INDEX orders_status (status),
  FOREIGN KEY (customer_id) REFERENCES customers (id)
) COMMENT = 'One row per order attempt, including failed ones.';

CREATE TABLE deploys (
  id bigint PRIMARY KEY,
  service varchar(40) NOT NULL,
  version varchar(20) NOT NULL,
  deployed_at datetime NOT NULL,
  author varchar(40) NOT NULL
) COMMENT = 'One row per production deploy. Good for chart markers.';

CREATE VIEW failed_orders AS
SELECT id, status, failure_reason, created_at FROM orders WHERE status = 'failed';
