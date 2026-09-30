-- Seeds the orders around the incident: deploy #481 of checkout-svc, yesterday at 12:02 UTC, the
-- same instant the synthetic metrics use (dev/metrics/incident.ts). One order attempt every five
-- seconds, from eight hours before the incident until now. The random draws hash the row number,
-- so a seed is the same every time.

INSERT INTO orders.customers
SELECT number, concat('customer', toString(number), '@example.com'),
  concat('Customer ', toString(number)), ['CH', 'DE', 'FR', 'IT', 'AT'][1 + number % 5],
  now('UTC') - toIntervalDay(number % 700)
FROM numbers(1, 500);

-- The same curve as incidentIntensity() in dev/metrics/incident.ts.
INSERT INTO orders.orders
WITH
  toDateTime64(toDate(now('UTC')) - 1, 3, 'UTC') + toIntervalSecond(43320) AS incident_at,
  incident_at - toIntervalHour(8) + toIntervalSecond(number * 5) AS at,
  dateDiff('second', incident_at, at) / 60 AS minutes,
  cityHash64(number, 5) % 1000000 / 1000000 < 0.004 + 0.6 * multiIf(
    minutes < 1 OR minutes > 36, 0,
    minutes < 12, (minutes - 1) / 11,
    minutes < 20, 1,
    (36 - minutes) / 16) AS failed,
  500 + cityHash64(number, 3) % 20000 AS cents
SELECT
  number + 1,
  1 + cityHash64(number, 42) % 500,
  multiIf(failed, 'failed', cityHash64(number, 7) % 100 = 0, 'refunded', 'paid'),
  if(failed, ['payment_gateway_timeout', 'payment_gateway_502', 'card_declined'][1 + cityHash64(number, 11) % 3], NULL),
  cents, toDecimal64(cents, 2) / 100, 'CHF', 'checkout-svc', at
FROM numbers(100000)
WHERE at <= now64(3, 'UTC');

-- 480 earlier deploys, then #481 (the incident), #482 (its rollback) and a few after.
INSERT INTO orders.deploys
WITH toDateTime(toDate(now('UTC')) - 1, 'UTC') + toIntervalSecond(43320) AS incident_at
SELECT number, ['checkout-svc', 'payments-svc', 'cart-svc', 'catalog-svc'][1 + number % 4],
  concat('1.', toString(intDiv(number, 10)), '.', toString(number % 10)),
  incident_at - toIntervalHour((481 - number) * 7),
  ['alice', 'bruno', 'chiara', 'dmitri'][1 + number % 4]
FROM numbers(1, 480);

INSERT INTO orders.deploys
WITH toDateTime(toDate(now('UTC')) - 1, 'UTC') + toIntervalSecond(43320) AS incident_at
SELECT * FROM (
  SELECT 481, 'checkout-svc', '2.14.0', incident_at, 'bruno'
  UNION ALL SELECT 482, 'checkout-svc', '2.13.4', incident_at + toIntervalMinute(36), 'alice'
  UNION ALL SELECT 483, 'payments-svc', '3.2.1', incident_at + toIntervalMinute(180), 'chiara'
  UNION ALL SELECT 484, 'catalog-svc', '5.0.2', incident_at + toIntervalMinute(300), 'dmitri'
);
