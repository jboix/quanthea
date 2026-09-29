import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { connectorInputSchema } from '@querent/shared';
import {
  devPostgres,
  devPrometheus,
  integrationEnabled,
} from '../../connectors/_shared/test/dev-sources.ts';
import { connectorKinds } from '../../connectors/registry.ts';
import { temporaryDir, testServices } from '../../test/fixtures.ts';
import { applyEdit } from './edit.ts';
import { editRequestSchema } from './request.ts';

let dataDir: ReturnType<typeof temporaryDir>;
let services: Awaited<ReturnType<typeof testServices>>;

const prom = 'prometheus-dev';
const shop = 'postgres-orders';

/**
 * An edit with one panel of every recipe, over the dev data.
 *
 * @returns The edit, parsed.
 */
function everyRecipe() {
  // The seeded rows sit around the day the dev database was created: look back far enough.
  const time = { from: 'now-30d', to: 'now' };
  const checkout = { field: 'service', value: 'checkout-svc' };
  return editRequestSchema.parse({
    title: 'Every recipe',
    time,
    variables: [{ kind: 'interval', name: 'interval', options: ['1m', '5m'], default: '5m' }],
    panels: [
      {
        recipe: 'rate',
        title: 'Requests',
        connector: prom,
        metric: 'http_requests_total',
        by: ['service'],
        window: '$interval',
      },
      {
        recipe: 'ratio',
        title: 'Errors',
        connector: prom,
        metric: 'http_requests_total',
        filters: [checkout],
        match: [{ field: 'code', op: '=~', value: '5..' }],
        show: 'stat',
      },
      {
        recipe: 'latency',
        title: 'Latency',
        connector: prom,
        metric: 'http_request_duration_seconds',
        filters: [checkout],
      },
      { recipe: 'gauge', title: 'Series', connector: prom, metric: 'up', aggregate: 'sum' },
      {
        recipe: 'top',
        title: 'Top codes',
        connector: prom,
        metric: 'http_requests_total',
        by: ['code'],
        show: 'bar',
      },
      {
        recipe: 'sql-series',
        title: 'Orders',
        connector: shop,
        table: 'orders',
        time: 'created_at',
        by: 'status',
        bucket: '$interval',
      },
      {
        recipe: 'sql-breakdown',
        title: 'Failures',
        connector: shop,
        table: 'orders',
        by: 'failure_reason',
        time: 'created_at',
        filters: [{ field: 'status', value: 'failed' }],
      },
      {
        recipe: 'sql-stat',
        title: 'Revenue',
        connector: shop,
        table: 'orders',
        time: 'created_at',
        measure: { fn: 'sum', column: 'total_cents' },
      },
      {
        recipe: 'sql-rows',
        title: 'Declines',
        connector: shop,
        table: 'payments',
        columns: ['created_at', 'provider', 'error_code'],
        time: 'created_at',
        filters: [{ field: 'status', value: 'declined' }],
      },
    ],
    markers: {
      label: 'deploy',
      connector: shop,
      table: 'deploys',
      time: 'deployed_at',
      text: 'version',
    },
    summary: 'every recipe',
  });
}

describe.skipIf(!integrationEnabled)('recipes over the dev data', () => {
  beforeAll(async () => {
    dataDir = temporaryDir();
    services = await testServices(dataDir.path, connectorKinds);
    const inputs = [
      { name: shop, kind: 'postgres', ...devPostgres },
      { name: prom, kind: 'prometheus', ...devPrometheus },
    ];
    for (const input of inputs)
      await services.connections.create(connectorInputSchema.parse(input), 'admin-1');
  });

  afterAll(async () => {
    await services.close();
    dataDir.remove();
  });

  test('every recipe checks, runs and returns rows', async () => {
    const checked = services.dashboards.check(applyEdit(undefined, everyRecipe()));
    expect(checked.ok ? [] : checked.issues).toEqual([]);
    if (!checked.ok) return;
    const tests = await services.dashboards.testRun(checked.spec);
    const outcomes = tests.map((panel) => ({
      panel: panel.panelId,
      errors: panel.run.queries.flatMap((query) => (query.error ? [query.error] : [])),
      rows: panel.run.queries.some((query) =>
        query.frames.some((frame) => frame.meta.rowCount > 0),
      ),
    }));
    expect(outcomes).toEqual(
      outcomes.map((outcome) => ({ panel: outcome.panel, errors: [], rows: true })),
    );
  });
});
