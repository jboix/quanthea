-- The orders database of the dev environment: an outdoor shop with 60 days of orders, whose checkout
-- had an incident yesterday.

CREATE TABLE customers (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email text NOT NULL,
  phone text NOT NULL,
  name text NOT NULL,
  country text NOT NULL,
  created_at timestamptz NOT NULL
);
COMMENT ON TABLE customers IS 'Shop customers. email and phone are personal data.';

CREATE TABLE products (
  sku text PRIMARY KEY,
  name text NOT NULL,
  category text NOT NULL,
  price_cents integer NOT NULL
);
COMMENT ON TABLE products IS 'The catalogue: one row per product, with its category and price.';

CREATE TABLE orders (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id bigint NOT NULL REFERENCES customers (id),
  status text NOT NULL CHECK (status IN ('paid', 'failed', 'refunded')),
  failure_reason text,
  total_cents integer NOT NULL,
  currency text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('web', 'app', 'marketplace')),
  service text NOT NULL,
  created_at timestamptz NOT NULL
);
COMMENT ON TABLE orders IS 'One row per order attempt, including failed ones. total_cents is in centimes: divide by 100 for CHF.';
CREATE INDEX orders_status ON orders (status);
CREATE INDEX orders_created_at ON orders (created_at);

CREATE TABLE order_items (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id bigint NOT NULL REFERENCES orders (id),
  sku text NOT NULL REFERENCES products (sku),
  quantity integer NOT NULL,
  unit_price_cents integer NOT NULL
);

CREATE INDEX order_items_order_id ON order_items (order_id);

CREATE TABLE payments (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id bigint NOT NULL REFERENCES orders (id),
  provider text NOT NULL,
  status text NOT NULL CHECK (status IN ('authorized', 'declined', 'error')),
  error_code text,
  amount_cents integer NOT NULL,
  card_last4 text NOT NULL,
  created_at timestamptz NOT NULL
);
COMMENT ON TABLE payments IS 'Card authorizations, one per attempt.';
CREATE INDEX payments_created_at ON payments (created_at);

CREATE TABLE refunds (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  payment_id bigint NOT NULL REFERENCES payments (id),
  amount_cents integer NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE deploys (
  id bigint PRIMARY KEY,
  service text NOT NULL,
  version text NOT NULL,
  deployed_at timestamptz NOT NULL,
  author text NOT NULL
);
COMMENT ON TABLE deploys IS 'One row per production deploy. Good for chart markers.';
