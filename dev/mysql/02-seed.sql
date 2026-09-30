-- Seeds the orders around the incident: deploy #481 of checkout-svc, yesterday at 12:02 UTC, the
-- same instant the synthetic metrics use (dev/metrics/incident.ts). One order attempt every five
-- seconds, from eight hours before the incident until now. Plain SQL both servers run.

SET time_zone = '+00:00';

SET @incident_at = TIMESTAMP(UTC_DATE() - INTERVAL 1 DAY, '12:02:00');
SET @start_at = @incident_at - INTERVAL 8 HOUR;

-- Plain tables: MySQL cannot read a temporary table twice in one query.
CREATE TABLE seed_digits (d int PRIMARY KEY);
INSERT INTO seed_digits VALUES (0), (1), (2), (3), (4), (5), (6), (7), (8), (9);

CREATE TABLE seed_numbers (n int PRIMARY KEY);
INSERT INTO seed_numbers (n)
SELECT a.d + 10 * b.d + 100 * c.d + 1000 * e.d + 10000 * f.d
FROM seed_digits a, seed_digits b, seed_digits c, seed_digits e, seed_digits f;

INSERT INTO customers (email, name, country, created_at)
SELECT CONCAT('customer', n, '@example.com'), CONCAT('Customer ', n),
  ELT(1 + n % 5, 'CH', 'DE', 'FR', 'IT', 'AT'), UTC_TIMESTAMP() - INTERVAL (n % 700) DAY
FROM seed_numbers WHERE n BETWEEN 1 AND 500;

-- The same curve as incidentIntensity() in dev/metrics/incident.ts.
INSERT INTO orders (customer_id, status, failure_reason, total_cents, total, currency, service, created_at)
SELECT
  1 + FLOOR(RAND(42) * 500),
  CASE WHEN failed THEN 'failed' WHEN RAND(7) < 0.01 THEN 'refunded' ELSE 'paid' END,
  CASE WHEN failed THEN ELT(1 + FLOOR(RAND(11) * 3), 'payment_gateway_timeout', 'payment_gateway_502', 'card_declined') END,
  cents, cents / 100, 'CHF', 'checkout-svc', at
FROM (
  SELECT at, 500 + FLOOR(RAND(3) * 20000) AS cents,
    RAND(5) < 0.004 + 0.6 * CASE
      WHEN minutes < 1 OR minutes > 36 THEN 0
      WHEN minutes < 12 THEN (minutes - 1) / 11
      WHEN minutes < 20 THEN 1
      ELSE (36 - minutes) / 16
    END AS failed
  FROM (
    SELECT @start_at + INTERVAL (n * 5) SECOND AS at,
      TIMESTAMPDIFF(SECOND, @incident_at, @start_at + INTERVAL (n * 5) SECOND) / 60 AS minutes
    FROM seed_numbers
  ) AS clock
  WHERE at <= UTC_TIMESTAMP()
) AS attempts;

-- 480 earlier deploys, then #481 (the incident), #482 (its rollback) and a few after.
INSERT INTO deploys (id, service, version, deployed_at, author)
SELECT n, ELT(1 + n % 4, 'checkout-svc', 'payments-svc', 'cart-svc', 'catalog-svc'),
  CONCAT('1.', n DIV 10, '.', n % 10), @incident_at - INTERVAL ((481 - n) * 7) HOUR,
  ELT(1 + n % 4, 'alice', 'bruno', 'chiara', 'dmitri')
FROM seed_numbers WHERE n BETWEEN 1 AND 480;

INSERT INTO deploys (id, service, version, deployed_at, author) VALUES
  (481, 'checkout-svc', '2.14.0', @incident_at, 'bruno'),
  (482, 'checkout-svc', '2.13.4', @incident_at + INTERVAL 36 MINUTE, 'alice'),
  (483, 'payments-svc', '3.2.1', @incident_at + INTERVAL 180 MINUTE, 'chiara'),
  (484, 'catalog-svc', '5.0.2', @incident_at + INTERVAL 300 MINUTE, 'dmitri');

DROP TABLE seed_digits, seed_numbers;

ANALYZE TABLE customers, orders, deploys;
