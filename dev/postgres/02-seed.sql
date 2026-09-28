-- Seeds the orders around the incident: deploy #481 of checkout-svc, yesterday at 12:02 UTC, the
-- same instant the synthetic metrics use (dev/metrics/incident.ts).

SELECT setseed(0.42);

CREATE TEMPORARY TABLE seed_clock AS
SELECT
  (date_trunc('day', now() AT TIME ZONE 'UTC') - interval '1 day' + interval '12 hours 2 minutes')
    AT TIME ZONE 'UTC' AS incident_at;

-- The same curve as incidentIntensity() in dev/metrics/incident.ts.
CREATE FUNCTION pg_temp.intensity(minutes double precision) RETURNS double precision
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN minutes < 1 OR minutes > 36 THEN 0
    WHEN minutes < 12 THEN (minutes - 1) / 11
    WHEN minutes < 20 THEN 1
    ELSE (36 - minutes) / 16
  END
$$;

INSERT INTO customers (email, phone, name, country, created_at)
SELECT
  'customer' || i || '@example.com',
  '+41 79 ' || lpad(((i * 7919) % 10000000)::text, 7, '0'),
  'Customer ' || i,
  (ARRAY['CH', 'DE', 'FR', 'IT', 'AT'])[1 + i % 5],
  now() - (i % 700) * interval '1 day'
FROM generate_series(1, 2000) AS i;

-- One order attempt per second, from eight hours before the incident until now.
INSERT INTO orders (customer_id, status, failure_reason, total_cents, currency, service, created_at)
SELECT
  1 + floor(random() * 2000)::bigint,
  CASE WHEN failed THEN 'failed' WHEN random() < 0.01 THEN 'refunded' ELSE 'paid' END,
  CASE WHEN failed THEN (ARRAY['payment_gateway_timeout', 'payment_gateway_502', 'card_declined'])[1 + floor(random() * 3)::int] END,
  (500 + floor(random() * 20000))::integer,
  'CHF',
  'checkout-svc',
  at
FROM (
  SELECT
    at,
    random() < 0.004 + 0.6 * pg_temp.intensity(extract(epoch FROM at - incident_at) / 60) AS failed
  FROM seed_clock,
    generate_series(incident_at - interval '8 hours', now(), interval '1 second') AS at
) AS attempts;

INSERT INTO order_items (order_id, sku, quantity, unit_price_cents)
SELECT o.id, 'SKU-' || lpad((1 + floor(random() * 400))::text, 4, '0'), 1 + floor(random() * 3)::int, (200 + floor(random() * 8000))::integer
FROM orders AS o, generate_series(1, 1 + (o.id % 3)::int);

INSERT INTO payments (order_id, provider, status, error_code, amount_cents, card_last4, created_at)
SELECT
  o.id,
  (ARRAY['stripe', 'adyen'])[1 + (o.id % 2)::int],
  CASE
    WHEN o.failure_reason = 'card_declined' THEN 'declined'
    WHEN o.status = 'failed' THEN 'error'
    ELSE 'authorized'
  END,
  CASE WHEN o.status = 'failed' THEN o.failure_reason END,
  o.total_cents,
  lpad(((o.id * 31) % 10000)::text, 4, '0'),
  o.created_at + interval '400 milliseconds'
FROM orders AS o;

INSERT INTO refunds (payment_id, amount_cents, reason, created_at)
SELECT p.id, p.amount_cents, (ARRAY['customer_request', 'duplicate', 'fraud'])[1 + (p.id % 3)::int], p.created_at + interval '2 hours'
FROM payments AS p
JOIN orders AS o ON o.id = p.order_id
WHERE o.status = 'refunded';

-- 480 earlier deploys, then #481 (the incident), #482 (its rollback) and a few after.
INSERT INTO deploys (id, service, version, deployed_at, author)
SELECT
  i,
  (ARRAY['checkout-svc', 'payments-svc', 'cart-svc', 'catalog-svc'])[1 + i % 4],
  '1.' || (i / 10) || '.' || (i % 10),
  incident_at - (481 - i) * interval '7 hours',
  (ARRAY['alice', 'bruno', 'chiara', 'dmitri'])[1 + i % 4]
FROM seed_clock, generate_series(1, 480) AS i;

INSERT INTO deploys (id, service, version, deployed_at, author)
SELECT id, service, version, incident_at + offset_minutes * interval '1 minute', author
FROM seed_clock, (VALUES
  (481, 'checkout-svc', '2.14.0', 0, 'bruno'),
  (482, 'checkout-svc', '2.13.4', 36, 'alice'),
  (483, 'payments-svc', '3.2.1', 180, 'chiara'),
  (484, 'catalog-svc', '5.0.2', 300, 'dmitri')
) AS later (id, service, version, offset_minutes, author);

ANALYZE;
