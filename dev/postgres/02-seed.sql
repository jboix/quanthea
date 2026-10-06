-- Seeds an outdoor shop's last 60 days, up to now: a catalogue, customers in six countries, and
-- order attempts that follow the day (a lunch and an evening peak, on the Zurich clock), the week
-- (busier weekends), a slow growth and one promotion day. Yesterday at 12:02 UTC, deploy #481 of
-- checkout-svc breaks the payment gateway for 36 minutes, the same instant the synthetic metrics use
-- (dev/metrics/incident.ts). The random generator is seeded, so every seed gives the same shop.

SELECT setseed(0.42);

CREATE TEMPORARY TABLE seed_clock AS
SELECT
  (date_trunc('day', now() AT TIME ZONE 'UTC') - interval '1 day' + interval '12 hours 2 minutes')
    AT TIME ZONE 'UTC' AS incident_at,
  (date_trunc('day', now() AT TIME ZONE 'UTC') - interval '59 days') AT TIME ZONE 'UTC' AS since,
  (date_trunc('day', now() AT TIME ZONE 'Europe/Zurich') - interval '23 days')::date AS promo_day;

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

-- Orders per minute at a local hour of the day: quiet nights, a morning rise, a lunch peak and the
-- evening's, the highest.
CREATE FUNCTION pg_temp.daily(hour double precision) RETURNS double precision
LANGUAGE sql IMMUTABLE AS $$
  SELECT 0.1
    + 0.45 * exp(-((hour - 8.5) ^ 2) / 4)
    + 0.85 * exp(-((hour - 12.5) ^ 2) / 3)
    + 1.0 * exp(-((hour - 20.5) ^ 2) / 5)
$$;

-- The week: weekends are busier, Mondays quieter.
CREATE FUNCTION pg_temp.weekly(day_of_week integer) RETURNS double precision
LANGUAGE sql IMMUTABLE AS $$
  SELECT (ARRAY[1.35, 0.92, 1.0, 1.0, 1.04, 1.12, 1.28])[day_of_week + 1]
$$;

INSERT INTO products (sku, name, category, price_cents)
SELECT 'SKU-' || lpad(row_number() OVER ()::text, 3, '0'), name, category, price_cents
FROM (VALUES
  ('Trail runner 2', 'Footwear', 15900), ('Approach shoe', 'Footwear', 17900),
  ('Hiking boot GTX', 'Footwear', 22900), ('Trail runner 2 wide', 'Footwear', 15900),
  ('Camp slipper', 'Footwear', 4900), ('Mountain boot', 'Footwear', 34900),
  ('Running sandal', 'Footwear', 8900), ('Kids hiking boot', 'Footwear', 9900),
  ('Merino base layer', 'Apparel', 8900), ('Rain shell', 'Apparel', 24900),
  ('Down jacket', 'Apparel', 27900), ('Fleece midlayer', 'Apparel', 11900),
  ('Trail shorts', 'Apparel', 5900), ('Softshell pants', 'Apparel', 12900),
  ('Merino socks', 'Apparel', 2400), ('Sun hoodie', 'Apparel', 6900),
  ('Beanie', 'Apparel', 2900), ('Insulated vest', 'Apparel', 14900),
  ('Day pack 22 L', 'Gear', 11900), ('Trek pack 45 L', 'Gear', 21900),
  ('Hiking poles', 'Gear', 9900), ('Headlamp 400', 'Gear', 5900),
  ('Sleeping bag -5', 'Gear', 29900), ('Sleeping mat', 'Gear', 13900),
  ('Tent 2P', 'Gear', 44900), ('Stove kit', 'Gear', 8900),
  ('Water filter', 'Gear', 4900), ('Cook pot', 'Gear', 3900),
  ('Bottle 1 L', 'Accessories', 2900), ('Sunglasses', 'Accessories', 11900),
  ('Gaiters', 'Accessories', 3900), ('Map case', 'Accessories', 1900),
  ('First aid kit', 'Accessories', 3400), ('Dry bag 10 L', 'Accessories', 2400),
  ('Gloves', 'Accessories', 4400), ('Buff', 'Accessories', 2200),
  ('Insoles', 'Accessories', 3900), ('Sun cream', 'Accessories', 1600),
  ('Carabiner set', 'Accessories', 2900), ('Repair kit', 'Accessories', 1900)
) AS catalogue (name, category, price_cents);

INSERT INTO customers (email, phone, name, country, created_at)
SELECT
  'customer' || i || '@example.com',
  '+41 79 ' || lpad(((i * 7919) % 10000000)::text, 7, '0'),
  'Customer ' || i,
  CASE
    WHEN r < 0.40 THEN 'CH' WHEN r < 0.65 THEN 'DE' WHEN r < 0.77 THEN 'AT'
    WHEN r < 0.87 THEN 'FR' WHEN r < 0.95 THEN 'IT' ELSE 'NL'
  END,
  now() - (random() * 730) * interval '1 day'
FROM (SELECT i, random() AS r FROM generate_series(1, 8000) AS i) AS people;

-- How many attempts each minute expects, from the day, the week, the growth and the promotion.
CREATE TEMPORARY TABLE seed_minutes AS
SELECT
  minute,
  5
    * pg_temp.daily(extract(hour FROM local) + extract(minute FROM local) / 60)
    * pg_temp.weekly(extract(dow FROM local)::integer)
    * (0.82 + 0.36 * extract(epoch FROM minute - since) / (60 * 86400))
    * CASE WHEN local::date = promo_day AND extract(hour FROM local) >= 7 THEN 2.1 ELSE 1 END
    * (0.85 + 0.3 * random()) AS expected
FROM seed_clock,
  generate_series(since, now(), interval '1 minute') AS minute,
  LATERAL (SELECT minute AT TIME ZONE 'Europe/Zurich' AS local) AS clock;

INSERT INTO orders (customer_id, status, failure_reason, total_cents, currency, channel, service, created_at)
SELECT
  1 + floor(random() * 8000)::bigint,
  CASE WHEN failed THEN 'failed' WHEN random() < 0.015 THEN 'refunded' ELSE 'paid' END,
  CASE
    WHEN NOT failed THEN NULL
    WHEN incident > 0 AND random() < 0.9 THEN (ARRAY['payment_gateway_timeout', 'payment_gateway_502'])[1 + floor(random() * 2)::int]
    ELSE 'card_declined'
  END,
  0,
  'CHF',
  CASE WHEN channel_pick < 0.5 THEN 'web' WHEN channel_pick < 0.86 THEN 'app' ELSE 'marketplace' END,
  'checkout-svc',
  at
FROM (
  SELECT
    at,
    pg_temp.intensity(extract(epoch FROM at - incident_at) / 60) AS incident,
    random() < 0.012 + 0.75 * pg_temp.intensity(extract(epoch FROM at - incident_at) / 60) AS failed,
    random() AS channel_pick
  FROM seed_clock, seed_minutes,
    LATERAL generate_series(1, floor(expected + random())::integer) AS attempt,
    LATERAL (SELECT minute + random() * interval '1 minute' AS at) AS moment
  WHERE at <= now()
) AS attempts;

-- One to three products per order, the popular ones more often. Each lateral refers to its row, so
-- Postgres draws new random numbers for every order and every line, not once for all.
INSERT INTO order_items (order_id, sku, quantity, unit_price_cents)
SELECT o.id, p.sku, pick.quantity, p.price_cents
FROM orders AS o
CROSS JOIN LATERAL generate_series(
  1, 1 + (random() + 0 * o.id < 0.35)::int + (random() + 0 * o.id < 0.1)::int
) AS line
CROSS JOIN LATERAL (
  SELECT 'SKU-' || lpad((1 + floor(40 * random() ^ 1.8))::text, 3, '0') AS sku,
    1 + (random() < 0.12)::int AS quantity
  WHERE line > 0
) AS pick
JOIN products AS p ON p.sku = pick.sku;

UPDATE orders AS o
SET total_cents = items.total
FROM (SELECT order_id, sum(quantity * unit_price_cents) AS total FROM order_items GROUP BY order_id) AS items
WHERE items.order_id = o.id;

INSERT INTO payments (order_id, provider, status, error_code, amount_cents, card_last4, created_at)
SELECT
  o.id,
  CASE WHEN r < 0.45 THEN 'stripe' WHEN r < 0.75 THEN 'adyen' WHEN r < 0.9 THEN 'twint' ELSE 'paypal' END,
  CASE
    WHEN o.failure_reason = 'card_declined' THEN 'declined'
    WHEN o.status = 'failed' THEN 'error'
    ELSE 'authorized'
  END,
  CASE WHEN o.status = 'failed' THEN o.failure_reason END,
  o.total_cents,
  lpad(((o.id * 31) % 10000)::text, 4, '0'),
  o.created_at + interval '400 milliseconds'
FROM (SELECT *, random() AS r FROM orders) AS o;

INSERT INTO refunds (payment_id, amount_cents, reason, created_at)
SELECT p.id, p.amount_cents, (ARRAY['customer_request', 'wrong_size', 'duplicate', 'fraud'])[1 + (p.id % 4)::int], p.created_at + interval '2 days'
FROM payments AS p
JOIN orders AS o ON o.id = p.order_id
WHERE o.status = 'refunded' AND p.created_at + interval '2 days' <= now();

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
