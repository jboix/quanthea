/**
 * Prints the mongosh script that seeds the dev MongoDB, once per data volume: the read-only user
 * dash_ro, the shop's orders around the incident (checkout's failures rise with it), the deploys,
 * and a view of the failed orders. Usage: `bun seed.ts > seed.js && mongosh --file seed.js <url>`.
 */
import {
  errorCodes,
  errorRatio,
  incidentIntensity,
  incidentStart,
  requestRate,
  services,
} from '../metrics/incident.ts';

/** Milliseconds per minute. */
const minute = 60_000;

/** Documents per insertMany. */
const batchSize = 2000;

/** Why an order failed, in the order and shares of the error codes. */
const failureReasons = [
  'payment_gateway_502',
  'payment_gateway_timeout',
  'internal_error',
  'circuit_open',
];

/** The countries customers order from. */
const countries = ['DE', 'FR', 'CH', 'IT', 'ES', 'NL'];

/** The products, with their unit prices. */
const products: readonly [string, string][] = [
  ['SKU-1001', '19.90'],
  ['SKU-1002', '49.00'],
  ['SKU-2001', '5.50'],
  ['SKU-3001', '129.00'],
];

/**
 * A seeded random number generator, so every seed tells the same story.
 *
 * @param seed - The seed.
 * @returns A function that returns numbers in [0, 1).
 */
function generator(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const random = generator(481);

/**
 * Picks one item.
 *
 * @param items - The items.
 * @returns One of them.
 */
function pick<T>(items: readonly T[]): T {
  return items[Math.floor(random() * items.length)] as T;
}

/**
 * The reason of a failed order, by the shares of the error codes.
 *
 * @returns The reason.
 */
function failureReason(): string {
  let draw = random();
  for (const [index, { share }] of errorCodes.entries()) {
    draw -= share;
    if (draw < 0) return failureReasons[index] ?? 'other';
  }
  return 'other';
}

/**
 * One order, in canonical Extended JSON.
 *
 * @param at - When it was placed, in epoch milliseconds.
 * @param failureRatio - The chance it fails.
 * @returns The document.
 */
function order(at: number, failureRatio: number): Record<string, unknown> {
  const failed = random() < failureRatio;
  const items = Array.from({ length: 1 + Math.floor(random() * 3) }, () => {
    const [sku, price] = pick(products);
    return { sku, quantity: 1 + Math.floor(random() * 2), unit_price: { $numberDecimal: price } };
  });
  const total = items.reduce(
    (sum, item) => sum + Number(item.unit_price.$numberDecimal) * item.quantity,
    0,
  );
  return {
    status: failed ? 'failed' : 'paid',
    ...(failed ? { failure_reason: failureReason() } : {}),
    total: { $numberDecimal: total.toFixed(2) },
    currency: 'EUR',
    service: 'checkout-svc',
    customer: { country: pick(countries), returning: random() < 0.6 },
    items,
    created_at: { $date: new Date(at + Math.floor(random() * minute)).toISOString() },
  };
}

/**
 * The orders, every minute from eight hours before the incident until now.
 *
 * @param start - When the incident started.
 * @returns The documents.
 */
function orders(start: Date): Record<string, unknown>[] {
  const [checkout] = services;
  if (!checkout) return [];
  const documents: Record<string, unknown>[] = [];
  const first = Math.floor((start.getTime() - 8 * 3_600_000) / minute) * minute;
  for (let at = first; at <= Date.now() - minute; at += minute) {
    const time = new Date(at);
    const count = Math.max(1, Math.round(requestRate(checkout, 'prod', time) / 10));
    const ratio = errorRatio(checkout, 'prod', incidentIntensity(time, start));
    for (let index = 0; index < count; index += 1) documents.push(order(at, ratio));
  }
  return documents;
}

/**
 * The deploys, #478 to #484, the incident's #481 and its rollback #482 among them.
 *
 * @param start - When the incident started.
 * @returns The documents.
 */
function deploys(start: Date): Record<string, unknown>[] {
  const all: [number, string, string, string, number][] = [
    [478, 'cart-svc', '1.47.8', 'alice', -21 * 60],
    [479, 'catalog-svc', '1.47.9', 'alice', -14 * 60],
    [480, 'checkout-svc', '2.13.4', 'alice', -7 * 60],
    [481, 'checkout-svc', '2.14.0', 'bruno', 0],
    [482, 'checkout-svc', '2.13.4', 'alice', 36],
    [483, 'payments-svc', '3.2.1', 'chiara', 180],
    [484, 'catalog-svc', '5.0.2', 'dmitri', 300],
  ];
  return all
    .map(([id, service, version, author, minutes]) => ({
      _id: id,
      service,
      version,
      author,
      deployed_at: { $date: new Date(start.getTime() + minutes * minute).toISOString() },
    }))
    .filter((deploy) => Date.parse(deploy.deployed_at.$date) <= Date.now());
}

/**
 * The mongosh lines that insert documents in batches.
 *
 * @param collection - The collection.
 * @param documents - The documents, in canonical Extended JSON.
 * @returns The lines.
 */
function inserts(collection: string, documents: readonly Record<string, unknown>[]): string[] {
  const lines: string[] = [];
  for (let index = 0; index < documents.length; index += batchSize) {
    const batch = JSON.stringify(documents.slice(index, index + batchSize));
    lines.push(`  shop.${collection}.insertMany(EJSON.parse(${JSON.stringify(batch)}));`);
  }
  return lines;
}

const start = incidentStart(new Date());
const script = [
  "const shop = db.getSiblingDB('shop');",
  "if (!shop.getUser('dash_ro'))",
  "  shop.createUser({ user: 'dash_ro', pwd: 'dash-ro-dev', roles: [{ role: 'read', db: 'shop' }] });",
  'if (shop.orders.estimatedDocumentCount() === 0) {',
  ...inserts('orders', orders(start)),
  ...inserts('deploys', deploys(start)),
  '  shop.orders.createIndex({ created_at: 1 });',
  "  shop.createView('failed_orders', 'orders', [{ $match: { status: 'failed' } }]);",
  "  print('mongodb: seeded');",
  '}',
];
process.stdout.write(`${script.join('\n')}\n`);
