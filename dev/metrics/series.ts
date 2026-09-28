/** Cumulative counters for the synthetic metrics, advanced step by step through time. */
import {
  bucketShares,
  environments,
  errorCodes,
  errorRatio,
  incidentIntensity,
  p95Latency,
  requestRate,
  type Service,
  services,
} from './incident.ts';

/** One time series: its metric name, labels and current value. */
export interface Series {
  /** The metric name, with its `_total`, `_bucket`, `_sum` or `_count` suffix. */
  readonly name: string;
  /** The labels, rendered as `key="value"` pairs. */
  readonly labels: string;
  /** The cumulative value. */
  value: number;
}

/**
 * Renders labels in exposition format.
 *
 * @param labels - Label names and values. Values here are fixed names, never user input.
 * @returns The `{…}` label set.
 */
function renderLabels(labels: Readonly<Record<string, string>>): string {
  const pairs = Object.entries(labels).map(([name, value]) => `${name}="${value}"`);
  return `{${pairs.join(',')}}`;
}

/**
 * Creates the request counters of one service: one series per environment and status code.
 *
 * @param service - The service.
 * @returns The series, at zero.
 */
function requestSeries(service: Service): Series[] {
  const codes = ['200', ...errorCodes.map((entry) => entry.code)];
  return environments.flatMap((env) =>
    codes.map((code) => ({
      name: 'http_requests_total',
      labels: renderLabels({ service: service.name, env, code }),
      value: 0,
    })),
  );
}

/**
 * Creates the latency histogram of one service in prod: buckets, sum and count per route.
 *
 * @param service - The service.
 * @returns The series, at zero.
 */
function latencySeries(service: Service): Series[] {
  const bounds = ['0.05', '0.1', '0.25', '0.5', '1', '2.5', '5', '+Inf'];
  return service.routes.flatMap((route) => {
    const base = { service: service.name, env: 'prod', route };
    return [
      ...bounds.map((le) => ({
        name: 'http_request_duration_seconds_bucket',
        labels: renderLabels({ ...base, le }),
        value: 0,
      })),
      { name: 'http_request_duration_seconds_sum', labels: renderLabels(base), value: 0 },
      { name: 'http_request_duration_seconds_count', labels: renderLabels(base), value: 0 },
    ];
  });
}

/** Every series of one service, grouped for {@link advance}. */
interface ServiceSeries {
  /** The service. */
  readonly service: Service;
  /** Its request counters, in {@link requestSeries} order. */
  readonly requests: Series[];
  /** Its latency histogram, in {@link latencySeries} order. */
  readonly latency: Series[];
}

/**
 * Creates every series at zero.
 *
 * @returns The series, grouped by service.
 */
export function createSeries(): ServiceSeries[] {
  return services.map((service) => ({
    service,
    requests: requestSeries(service),
    latency: latencySeries(service),
  }));
}

/**
 * Adds one step of traffic to the request counters of a service.
 *
 * @param group - The service and its series.
 * @param time - The end of the step.
 * @param seconds - The step length.
 * @param intensity - The incident intensity during the step.
 */
function advanceRequests(
  group: ServiceSeries,
  time: Date,
  seconds: number,
  intensity: number,
): void {
  const perEnvironment = errorCodes.length + 1;
  environments.forEach((env, envIndex) => {
    const requests = requestRate(group.service, env, time) * seconds;
    const errors = requests * errorRatio(group.service, env, intensity);
    const counters = group.requests.slice(
      envIndex * perEnvironment,
      (envIndex + 1) * perEnvironment,
    );
    const increments = [requests - errors, ...errorCodes.map((entry) => errors * entry.share)];
    counters.forEach((counter, index) => {
      counter.value += Math.round(increments[index] ?? 0);
    });
  });
}

/**
 * Adds one step of traffic to the latency histogram of a service. Each route takes half the prod
 * requests.
 *
 * @param group - The service and its series.
 * @param time - The end of the step.
 * @param seconds - The step length.
 * @param intensity - The incident intensity during the step.
 */
function advanceLatency(
  group: ServiceSeries,
  time: Date,
  seconds: number,
  intensity: number,
): void {
  const requests = Math.round((requestRate(group.service, 'prod', time) * seconds) / 2);
  const p95 = p95Latency(group.service, intensity);
  const shares = [...bucketShares(p95), 1];
  const perRoute = shares.length + 2;
  group.service.routes.forEach((_route, routeIndex) => {
    const series = group.latency.slice(routeIndex * perRoute, (routeIndex + 1) * perRoute);
    shares.forEach((share, index) => {
      const bucket = series[index];
      if (bucket) bucket.value += Math.round(requests * share);
    });
    const [sum, count] = series.slice(shares.length);
    if (sum) sum.value += requests * (p95 * 0.42);
    if (count) count.value += requests;
  });
}

/**
 * Advances every series by one step of synthetic traffic.
 *
 * @param groups - The series from {@link createSeries}.
 * @param time - The end of the step.
 * @param seconds - The step length.
 * @param incident - When the incident starts.
 */
export function advance(
  groups: ServiceSeries[],
  time: Date,
  seconds: number,
  incident: Date,
): void {
  const intensity = incidentIntensity(time, incident);
  groups.forEach((group) => {
    advanceRequests(group, time, seconds, intensity);
    advanceLatency(group, time, seconds, intensity);
  });
}
