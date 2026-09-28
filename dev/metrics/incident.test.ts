import { describe, expect, test } from 'bun:test';
import {
  bucketShares,
  errorRatio,
  incidentIntensity,
  incidentStart,
  latencyBuckets,
  p95Latency,
  services,
} from './incident.ts';

const [checkout, payments, cart] = services;
const start = new Date('2026-09-27T12:02:00Z');

/**
 * A moment a number of minutes after the deploy.
 *
 * @param minutes - Minutes after the deploy.
 * @returns The moment.
 */
function after(minutes: number): Date {
  return new Date(start.getTime() + minutes * 60_000);
}

describe('incidentStart', () => {
  test('is yesterday at 12:02 UTC, whatever the time today', () => {
    expect(incidentStart(new Date('2026-09-28T00:10:00Z')).toISOString()).toBe(
      '2026-09-27T12:02:00.000Z',
    );
    expect(incidentStart(new Date('2026-09-28T23:59:00Z')).toISOString()).toBe(
      '2026-09-27T12:02:00.000Z',
    );
  });
});

describe('incidentIntensity', () => {
  test('rises after the deploy, holds, and ends with the rollback', () => {
    const curve = [0, 1, 6.5, 12, 19, 28, 36, 37].map((minutes) =>
      incidentIntensity(after(minutes), start),
    );
    expect(curve).toEqual([0, 0, 0.5, 1, 1, 0.5, 0, 0]);
  });
});

describe('errorRatio', () => {
  test('peaks at 8.4% for checkout in prod, less for payments, not at all for cart', () => {
    expect(errorRatio(checkout!, 'prod', 1)).toBeCloseTo(0.084);
    expect(errorRatio(payments!, 'prod', 1)).toBeCloseTo(0.0273);
    expect(errorRatio(cart!, 'prod', 1)).toBeCloseTo(0.003);
  });

  test('never touches staging', () => {
    expect(errorRatio(checkout!, 'staging', 1)).toBeCloseTo(0.003);
  });
});

describe('latency', () => {
  test('the p95 of checkout reaches 2.9 s at the top of the incident', () => {
    expect(p95Latency(checkout!, 0)).toBeCloseTo(0.31);
    expect(p95Latency(checkout!, 1)).toBeCloseTo(2.9);
  });

  test('bucket shares are cumulative and put 95% of requests under the p95', () => {
    const shares = bucketShares(0.5);
    shares.slice(1).forEach((share, index) => {
      expect(share).toBeGreaterThanOrEqual(shares[index] ?? 0);
    });
    expect(shares[latencyBuckets.indexOf(0.5)]).toBeCloseTo(0.95, 2);
  });
});
