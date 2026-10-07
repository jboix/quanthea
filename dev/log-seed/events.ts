/**
 * The synthetic request logs of the dev environment, from the same traffic model as the metrics:
 * one request log every two seconds per production service, from eight hours before the incident
 * until now, and the deploy and rollback of checkout-svc. The draws hash the time, so every seed
 * writes the same logs for the same incident.
 */
import {
  errorCodes,
  errorRatio,
  incidentIntensity,
  incidentStart,
  p95Latency,
  type Service,
  services,
} from '../metrics/incident.ts';

/** One log event. */
export interface LogEvent {
  /** When it happened, as an ISO time. */
  readonly '@timestamp': string;
  /** The service that wrote it. */
  readonly service: string;
  /** Always `prod`. */
  readonly env: 'prod';
  /** `info`, `warn` or `error`. */
  readonly level: 'info' | 'warn' | 'error';
  /** The route of the request, or `deploy`. */
  readonly route: string;
  /** The HTTP status, 0 for a deploy. */
  readonly status: number;
  /** How long the request took, in milliseconds. */
  readonly duration_ms: number;
  /** The message. */
  readonly message: string;
  /** The trace of the request. */
  readonly trace_id: string;
}

/** Seconds between two request logs of one service. */
const spacingSeconds = 2;

/** How long before the incident the logs start, in milliseconds. */
const leadMilliseconds = 8 * 60 * 60 * 1000;

/** What an error says, by status code. */
const errorMessages: Readonly<Record<string, string>> = {
  '502': 'bad gateway from payments-gateway',
  '504': 'payments-gateway timed out after 3000 ms',
  '500': 'unexpected error while confirming the order',
  '503': 'payments-gateway unavailable, circuit open',
};

/**
 * A number in [0, 1) drawn from a seed: the same seed, the same number.
 *
 * @param seed - The seed.
 * @returns The number.
 */
function draw(seed: number): number {
  let value = (seed + 0x6d2b79f5) | 0;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
}

/**
 * The status code of a failed request.
 *
 * @param roll - A number in [0, 1).
 * @returns One of {@link errorCodes}, by its share.
 */
function errorCode(roll: number): string {
  let total = 0;
  for (const { code, share } of errorCodes) {
    total += share;
    if (roll < total) return code;
  }
  return '500';
}

/**
 * The trace id of a request: 16 hexadecimal digits.
 *
 * @param seed - The request's seed.
 * @returns The id.
 */
function traceId(seed: number): string {
  const part = (offset: number): string =>
    Math.floor(draw(seed + offset) * 2 ** 32)
      .toString(16)
      .padStart(8, '0');
  return part(4) + part(5);
}

/**
 * The log of one request.
 *
 * @param service - The service.
 * @param time - When the request ended.
 * @param index - The service's position, which varies the draws.
 * @param start - When the incident started.
 * @returns The event.
 */
function requestEvent(service: Service, time: Date, index: number, start: Date): LogEvent {
  const seed = Math.floor(time.getTime() / 1000) * 8 + index;
  const intensity = incidentIntensity(time, start);
  const failed = draw(seed) < errorRatio(service, 'prod', intensity);
  const duration = Math.round(
    (p95Latency(service, intensity) / 3) * 1000 * (0.3 + 2 * draw(seed + 1)),
  );
  const status = failed ? Number(errorCode(draw(seed + 2))) : 200;
  const route = service.routes[draw(seed + 3) < 0.7 ? 0 : 1];
  const slowLevel = duration > 1000 ? 'warn' : 'info';
  const level = failed ? 'error' : slowLevel;
  const message = failed
    ? (errorMessages[String(status)] ?? 'request failed')
    : `${route} ${status} in ${duration} ms`;
  return {
    '@timestamp': time.toISOString(),
    service: service.name,
    env: 'prod',
    level,
    route,
    status,
    duration_ms: duration,
    message,
    trace_id: traceId(seed),
  };
}

/**
 * The deploy and the rollback of checkout-svc that start and end the incident.
 *
 * @param start - When the incident started.
 * @returns The two events.
 */
function deployEvents(start: Date): LogEvent[] {
  const deploy = (minutes: number, version: string): LogEvent => ({
    '@timestamp': new Date(start.getTime() + minutes * 60_000).toISOString(),
    service: 'checkout-svc',
    env: 'prod',
    level: 'info',
    route: 'deploy',
    status: 0,
    duration_ms: 0,
    message: `deployed version ${version}`,
    trace_id: '0000000000000000',
  });
  return [deploy(0, '2.14.0'), deploy(36, '2.13.4')];
}

/**
 * Every log event from eight hours before the incident until now, in time order.
 *
 * @param now - The current time.
 * @returns The events.
 */
export function logEvents(now: Date = new Date()): LogEvent[] {
  const start = incidentStart(now);
  const events = deployEvents(start);
  const first = start.getTime() - leadMilliseconds;
  for (let time = first; time <= now.getTime(); time += spacingSeconds * 1000) {
    services.forEach((service, index) => {
      events.push(requestEvent(service, new Date(time), index, start));
    });
  }
  return events.sort((a, b) => a['@timestamp'].localeCompare(b['@timestamp']));
}
