import { describe, expect, test } from 'bun:test';
import type { HealthReport } from '@quanthea/plugin-kit';
import { reachMethods } from './reach.ts';

/**
 * The access of one connector whose health test gives a report, or of none.
 *
 * @param report - The report, or `undefined` for a connector that cannot be opened.
 * @returns The access.
 */
function accessWith(report: HealthReport | undefined) {
  const open = () =>
    report
      ? Promise.resolve({ source: { instance: { test: () => Promise.resolve(report) } } })
      : Promise.reject(new Error('No such connector.'));
  return { open };
}

const signal = AbortSignal.timeout(1000);

describe('whether a connector answers', () => {
  test('is yes when its health test passes', async () => {
    const report = { ok: true, latencyMs: 1, message: 'PostgreSQL 17.', readOnly: true };
    expect(await reachMethods(accessWith(report)).reach('orders', signal)).toBe(true);
  });

  test('is no when its health test fails, and says nothing of why', async () => {
    const report = { ok: false, latencyMs: 1, message: 'connect ECONNREFUSED', readOnly: null };
    expect(await reachMethods(accessWith(report)).reach('orders', signal)).toBe(false);
  });

  test('is no when it cannot be opened', async () => {
    expect(await reachMethods(accessWith(undefined)).reach('orders', signal)).toBe(false);
  });
});
