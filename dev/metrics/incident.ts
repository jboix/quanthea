/** The synthetic traffic model shared by the metrics history and the live metrics endpoint. */

/** A service that the synthetic traffic describes. */
export interface Service {
  /** The `service` label value. */
  readonly name: string;
  /** Requests per second in `prod` at the daily peak. */
  readonly peakRate: number;
  /** The two routes the latency histogram reports. */
  readonly routes: readonly [string, string];
  /** How much of the incident this service feels: 1 for checkout, 0 for services it spares. */
  readonly incidentWeight: number;
}

/** The services, as in the seeded orders database. */
export const services: readonly Service[] = [
  {
    name: 'checkout-svc',
    peakRate: 40,
    routes: ['POST /checkout/confirm', 'GET /cart'],
    incidentWeight: 1,
  },
  {
    name: 'payments-svc',
    peakRate: 30,
    routes: ['POST /payments/authorize', 'GET /payments/status'],
    incidentWeight: 0.3,
  },
  {
    name: 'cart-svc',
    peakRate: 60,
    routes: ['GET /cart/items', 'POST /cart/items'],
    incidentWeight: 0,
  },
  {
    name: 'catalog-svc',
    peakRate: 120,
    routes: ['GET /products', 'GET /products/search'],
    incidentWeight: 0,
  },
];

/** The environments. Staging gets a twentieth of the traffic and never the incident. */
export const environments = ['prod', 'staging'] as const;

/** An environment label value. */
export type Environment = (typeof environments)[number];

/** The HTTP status codes counted, and the share of the errors each takes. */
export const errorCodes = [
  { code: '502', share: 0.45 },
  { code: '504', share: 0.25 },
  { code: '500', share: 0.2 },
  { code: '503', share: 0.1 },
] as const;

/** Upper bounds of the latency histogram buckets, in seconds. */
export const latencyBuckets = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5] as const;

/** The error ratio outside the incident. */
const baselineErrorRatio = 0.003;

/** The error ratio of checkout-svc at the top of the incident. */
const peakErrorRatio = 0.084;

/** The p95 latency outside the incident, in seconds. */
const baselineP95 = 0.31;

/** The p95 latency of checkout-svc at the top of the incident, in seconds. */
const peakP95 = 2.9;

/** Milliseconds per minute. */
const minute = 60_000;

/**
 * When deploy #481 of checkout-svc starts the incident: yesterday at 12:02 UTC. The Postgres seed
 * uses the same instant, so the metrics and the orders tell the same story.
 *
 * @param now - The current time.
 * @returns The deploy time.
 */
export function incidentStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1, 12, 2));
}

/**
 * How far into the incident a moment is, as a 0–1 intensity: it rises for 11 minutes after the
 * deploy, holds, and falls until the rollback 36 minutes after the deploy.
 *
 * @param time - The moment.
 * @param start - The deploy that starts the incident.
 * @returns 0 outside the incident, up to 1 at its top.
 */
export function incidentIntensity(time: Date, start: Date): number {
  const minutes = (time.getTime() - start.getTime()) / minute;
  if (minutes < 1 || minutes > 36) return 0;
  if (minutes < 12) return (minutes - 1) / 11;
  if (minutes < 20) return 1;
  return (36 - minutes) / 16;
}

/**
 * The daily traffic curve: lowest at 03:00 UTC, highest at 15:00 UTC.
 *
 * @param time - The moment.
 * @returns A factor between 0.25 and 1.
 */
function dailyFactor(time: Date): number {
  const hours = time.getUTCHours() + time.getUTCMinutes() / 60;
  return 0.625 - 0.375 * Math.cos(((hours - 3) / 24) * 2 * Math.PI);
}

/**
 * The request rate of a service in an environment.
 *
 * @param service - The service.
 * @param environment - The environment.
 * @param time - The moment.
 * @returns Requests per second.
 */
export function requestRate(service: Service, environment: Environment, time: Date): number {
  const environmentFactor = environment === 'prod' ? 1 : 0.05;
  return service.peakRate * environmentFactor * dailyFactor(time);
}

/**
 * The share of requests that fail with a 5xx.
 *
 * @param service - The service.
 * @param environment - The environment.
 * @param intensity - The incident intensity at that moment.
 * @returns The error ratio, between 0 and 1.
 */
export function errorRatio(service: Service, environment: Environment, intensity: number): number {
  if (environment !== 'prod') return baselineErrorRatio;
  const weight = service.incidentWeight * intensity;
  return baselineErrorRatio + (peakErrorRatio - baselineErrorRatio) * weight;
}

/**
 * The p95 latency of a service.
 *
 * @param service - The service.
 * @param intensity - The incident intensity at that moment.
 * @returns Seconds.
 */
export function p95Latency(service: Service, intensity: number): number {
  return baselineP95 + (peakP95 - baselineP95) * service.incidentWeight * intensity;
}

/**
 * The standard normal cumulative distribution, by the Abramowitz and Stegun approximation.
 *
 * @param value - The point.
 * @returns The probability that a standard normal variable is at most `value`.
 */
function normalCdf(value: number): number {
  const factor = 1 / (1 + 0.2316419 * Math.abs(value));
  const density = Math.exp((-value * value) / 2) / Math.sqrt(2 * Math.PI);
  const polynomial =
    0.31938153 +
    factor *
      (-0.356563782 + factor * (1.781477937 + factor * (-1.821255978 + factor * 1.330274429)));
  const tail = density * factor * polynomial;
  return value >= 0 ? 1 - tail : tail;
}

/**
 * The share of requests at or below each latency bucket, for a log-normal latency whose median is
 * a third of its p95.
 *
 * @param p95 - The p95 latency in seconds.
 * @returns One cumulative share per bucket in {@link latencyBuckets}.
 */
export function bucketShares(p95: number): number[] {
  const median = p95 / 3;
  const sigma = Math.log(3) / 1.645;
  return latencyBuckets.map((bound) => normalCdf(Math.log(bound / median) / sigma));
}
