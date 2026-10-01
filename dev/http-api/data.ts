/**
 * The data the dev HTTP API serves, from the same incident model as the metrics: the services, the
 * deploys around deploy #481 of checkout-svc, and request and error counts over time.
 */
import {
  errorRatio,
  incidentIntensity,
  incidentStart,
  requestRate,
  type Service,
  services,
} from '../metrics/incident.ts';

/** A deploy. */
export interface Deploy {
  readonly id: number;
  readonly service: string;
  readonly version: string;
  readonly deployed_at: string;
  readonly author: string;
}

/** Requests and errors of a service over one step. */
export interface ErrorPoint {
  /** The start of the step, in epoch seconds. */
  readonly t: number;
  readonly requests: number;
  readonly errors: number;
  readonly error_ratio: number;
}

/** The authors of the deploys, in turn. */
const authors = ['alice', 'bruno', 'chiara', 'dmitri'];

/**
 * The services, with their team and tier.
 *
 * @returns One row per service.
 */
export function serviceRows() {
  return services.map((service, index) => ({
    name: service.name,
    team: ['payments', 'payments', 'shop', 'shop'][index] ?? 'shop',
    tier: service.incidentWeight > 0 ? 'critical' : 'standard',
    peak_rps: service.peakRate,
  }));
}

/**
 * Every deploy: 480 every seven hours before the incident, then #481 (the incident), #482 (its
 * rollback) and two after.
 *
 * @param now - The current time.
 * @returns The deploys, oldest first.
 */
export function deploys(now: Date = new Date()): Deploy[] {
  const start = incidentStart(now).getTime();
  const at = (minutes: number) => new Date(start + minutes * 60_000).toISOString();
  const earlier = Array.from({ length: 480 }, (_, index) => {
    const id = index + 1;
    return {
      id,
      service: services[id % 4]?.name ?? 'cart-svc',
      version: `1.${Math.floor(id / 10)}.${id % 10}`,
      deployed_at: at(-(481 - id) * 7 * 60),
      author: authors[id % 4] ?? 'alice',
    };
  });
  return [
    ...earlier,
    { id: 481, service: 'checkout-svc', version: '2.14.0', deployed_at: at(0), author: 'bruno' },
    { id: 482, service: 'checkout-svc', version: '2.13.4', deployed_at: at(36), author: 'alice' },
    { id: 483, service: 'payments-svc', version: '3.2.1', deployed_at: at(180), author: 'chiara' },
    { id: 484, service: 'catalog-svc', version: '5.0.2', deployed_at: at(300), author: 'dmitri' },
  ];
}

/**
 * The requests and errors of a service, step by step.
 *
 * @param service - The service.
 * @param from - The start, in epoch seconds.
 * @param to - The end, in epoch seconds.
 * @param step - Seconds per point.
 * @returns The points.
 */
export function errorPoints(
  service: Service,
  from: number,
  to: number,
  step: number,
): ErrorPoint[] {
  const start = incidentStart(new Date());
  const points: ErrorPoint[] = [];
  for (let t = Math.floor(from / step) * step; t <= to && points.length < 11_000; t += step) {
    const time = new Date(t * 1000);
    const requests = Math.round(requestRate(service, 'prod', time) * step);
    const ratio = errorRatio(service, 'prod', incidentIntensity(time, start));
    const errors = Math.round(requests * ratio);
    points.push({ t, requests, errors, error_ratio: requests === 0 ? 0 : errors / requests });
  }
  return points;
}
