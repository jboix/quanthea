/**
 * Seeds the dev Valkey with the incident, once per data volume: a hash per service, sorted sets
 * of the errors by reason and by service, a stream of deploys and a stream of checkout's requests
 * and errors per minute, a list of alerts and a counter. Usage: `bun seed.ts <url>`.
 */
import { RedisClient } from 'bun';
import {
  errorCodes,
  errorRatio,
  incidentIntensity,
  incidentStart,
  requestRate,
  services,
} from '../metrics/incident.ts';

const client = new RedisClient(process.argv[2] ?? 'redis://default:querent-dev@127.0.0.1:6379/0');

/** Milliseconds per minute. */
const minute = 60_000;

/**
 * The requests and errors of a service in one minute.
 *
 * @param service - The service.
 * @param time - The minute.
 * @param start - When the incident started.
 * @returns The counts.
 */
function countsAt(service: (typeof services)[number], time: Date, start: Date) {
  const requests = Math.round(requestRate(service, 'prod', time) * 60);
  return {
    requests,
    errors: Math.round(requests * errorRatio(service, 'prod', incidentIntensity(time, start))),
  };
}

/**
 * Writes the per-minute stream of checkout-svc, and returns the errors of each service over the
 * incident hour.
 *
 * @param start - When the incident started.
 * @returns The errors by service.
 */
async function writeTraffic(start: Date): Promise<Map<string, number>> {
  const errorsByService = new Map<string, number>();
  const first = Math.floor((start.getTime() - 8 * 3_600_000) / minute) * minute;
  const incidentEnd = start.getTime() + 3_600_000;
  const [checkoutService] = services;
  if (!checkoutService) return errorsByService;
  for (let at = first; at <= Date.now(); at += minute) {
    const checkout = countsAt(checkoutService, new Date(at), start);
    await client.send('XADD', [
      'checkout:requests',
      `${at}-0`,
      'requests',
      String(checkout.requests),
      'errors',
      String(checkout.errors),
    ]);
    if (at < start.getTime() || at >= incidentEnd) continue;
    for (const service of services) {
      const { errors } = countsAt(service, new Date(at), start);
      errorsByService.set(service.name, (errorsByService.get(service.name) ?? 0) + errors);
    }
  }
  return errorsByService;
}

/** A deploy: its number, service, version, author, and minutes from the incident. */
type Deploy = [number, string, string, string, number];

/** The incident's deploy #481, its rollback #482, and the two after. */
const incidentDeploys: Deploy[] = [
  [481, 'checkout-svc', '2.14.0', 'bruno', 0],
  [482, 'checkout-svc', '2.13.4', 'alice', 36],
  [483, 'payments-svc', '3.2.1', 'chiara', 180],
  [484, 'catalog-svc', '5.0.2', 'dmitri', 300],
];

/**
 * Writes the deploys, #470 to #484, the incident's #481 and its rollback #482 among them.
 *
 * @param start - When the incident started.
 * @returns Once written.
 */
async function writeDeploys(start: Date): Promise<void> {
  const earlier = Array.from({ length: 11 }, (_, index): Deploy => {
    const id = 470 + index;
    return [
      id,
      services[id % 4]?.name ?? 'cart-svc',
      `1.${Math.floor(id / 10)}.${id % 10}`,
      'alice',
      -(481 - id) * 7 * 60,
    ];
  });
  for (const [id, service, version, author, minutes] of [...earlier, ...incidentDeploys]) {
    const at = start.getTime() + minutes * minute;
    if (at > Date.now()) continue;
    await client.send('XADD', [
      'deploys',
      `${at}-0`,
      'id',
      String(id),
      'service',
      service,
      'version',
      version,
      'author',
      author,
    ]);
  }
}

if ((await client.send('EXISTS', ['deploys'])) === 0) {
  const start = incidentStart(new Date());
  for (const service of services) {
    const tier = service.incidentWeight > 0 ? 'critical' : 'standard';
    await client.send('HSET', [
      `service:${service.name}`,
      'tier',
      tier,
      'peak_rps',
      String(service.peakRate),
      'routes',
      service.routes.join(', '),
    ]);
  }
  const errorsByService = await writeTraffic(start);
  for (const [service, errors] of errorsByService)
    await client.send('ZADD', ['errors:by_service', String(errors), service]);
  const checkout = errorsByService.get('checkout-svc') ?? 0;
  const reasons = [
    'payment_gateway_502',
    'payment_gateway_timeout',
    'internal_error',
    'circuit_open',
  ];
  for (const [index, { share }] of errorCodes.entries())
    await client.send('ZADD', [
      'errors:by_reason',
      String(Math.round(checkout * share)),
      reasons[index] ?? 'other',
    ]);
  await writeDeploys(start);
  await client.send('RPUSH', [
    'alerts:recent',
    'checkout-svc 5xx above 5%',
    'checkout-svc p95 above 2 s',
    'payments-svc errors rising',
  ]);
  await client.send('SET', ['orders:failed:total', String(checkout)]);
  process.stdout.write('valkey: seeded\n');
}
client.close();
