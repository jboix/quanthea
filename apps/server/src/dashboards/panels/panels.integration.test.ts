import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { connectorInputSchema } from '@quanthea/shared';
import {
  devPostgres,
  devPrometheus,
  integrationEnabled,
} from '../../connectors/_shared/test/dev-sources.ts';
import { connectorKinds } from '../../connectors/registry.ts';
import { temporaryDir, testServices } from '../../test/fixtures.ts';
import { completeCharts } from './complete.ts';
import { applyEdit } from './edit.ts';
import { editRequestSchema } from './request.ts';

let dataDir: ReturnType<typeof temporaryDir>;
let services: Awaited<ReturnType<typeof testServices>>;

const prom = 'prometheus-dev';
const shop = 'postgres-orders';

/**
 * An edit with one panel of every query builder, each with a chart that suits it, over the dev data.
 *
 * @returns The edit, parsed.
 */
function everyBuilder() {
  // The seeded rows sit around the day the dev database was created: look back far enough.
  const time = { from: 'now-30d', to: 'now' };
  const checkout = { field: 'service', value: 'checkout-svc' };
  return editRequestSchema.parse({
    title: 'Every builder',
    time,
    variables: [{ kind: 'interval', name: 'interval', options: ['1m', '5m'], default: '5m' }],
    panels: [
      {
        title: 'Requests',
        data: {
          kind: 'rate',
          connector: prom,
          metric: 'http_requests_total',
          by: ['service'],
          window: '$interval',
        },
        chart: { recipe: 'trend.line' },
      },
      {
        title: 'Errors',
        data: {
          kind: 'ratio',
          connector: prom,
          metric: 'http_requests_total',
          filters: [checkout],
          match: [{ field: 'code', op: '=~', value: '5..' }],
        },
        chart: { recipe: 'kpi.stat' },
      },
      {
        title: 'Latency',
        data: {
          kind: 'latency',
          connector: prom,
          metric: 'http_request_duration_seconds',
          filters: [checkout],
        },
        chart: { recipe: 'trend.line' },
      },
      {
        title: 'Series',
        // A metric of the backfilled history: `up` exists only from the first live scrape.
        data: { kind: 'gauge', connector: prom, metric: 'http_requests_total', aggregate: 'sum' },
        chart: { recipe: 'kpi.big-number' },
      },
      {
        title: 'Top codes',
        data: { kind: 'top', connector: prom, metric: 'http_requests_total', by: ['code'] },
        chart: { recipe: 'comparison.ranked-bar' },
      },
      {
        title: 'Orders',
        data: {
          kind: 'sql-series',
          connector: shop,
          table: 'orders',
          time: 'created_at',
          by: 'status',
          bucket: '$interval',
        },
        chart: { recipe: 'trend.line' },
      },
      {
        title: 'Failures',
        data: {
          kind: 'sql-breakdown',
          connector: shop,
          table: 'orders',
          by: 'failure_reason',
          time: 'created_at',
          filters: [{ field: 'status', value: 'failed' }],
        },
        chart: { recipe: 'composition.pie' },
      },
      {
        title: 'Revenue',
        data: {
          kind: 'sql-stat',
          connector: shop,
          table: 'orders',
          time: 'created_at',
          measure: { fn: 'sum', column: 'total_cents' },
        },
        chart: { recipe: 'kpi.stat' },
      },
      {
        title: 'Declines',
        data: {
          kind: 'sql-rows',
          connector: shop,
          table: 'payments',
          columns: ['created_at', 'provider', 'error_code'],
          time: 'created_at',
          filters: [{ field: 'status', value: 'declined' }],
        },
        chart: { recipe: 'table.rows' },
      },
    ],
    markers: [
      {
        id: 'deploys',
        label: 'deploy',
        connector: shop,
        table: 'deploys',
        time: 'deployed_at',
        text: 'version',
      },
    ],
    summary: 'every builder',
  });
}

describe.skipIf(!integrationEnabled)('query builders over the dev data', () => {
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

  test('every builder runs and returns rows, and every chart completes from them', async () => {
    const { spec, charts } = applyEdit(undefined, everyBuilder());
    const tests = await services.dashboards.testRun(spec);
    const completed = completeCharts(spec, charts, tests);
    expect([...completed.problems.entries()]).toEqual([]);
    const checked = services.dashboards.check(completed.spec);
    expect(checked.ok ? [] : checked.issues).toEqual([]);
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

  test('marks only the deploys of the service the viewer chose', async () => {
    const names = ['checkout-svc', 'payments-svc'];
    const builders = everyBuilder();
    const service = { kind: 'custom', name: 'service', options: names, default: names[0] };
    const { spec, charts } = applyEdit(
      undefined,
      editRequestSchema.parse({
        title: 'Deploys by service',
        time: builders.time,
        variables: [...(builders.variables ?? []), service],
        panels: builders.panels.filter((panel) => panel.title === 'Orders'),
        markers: [
          {
            id: 'deploys',
            label: 'deploy',
            connector: shop,
            table: 'deploys',
            time: 'deployed_at',
            text: 'service',
            filters: [{ field: 'service', value: '$service' }],
          },
        ],
        summary: 'deploys of $service',
      }),
    );
    const completed = completeCharts(spec, charts, await services.dashboards.testRun(spec));
    const { id } = services.dashboards.create(completed.spec, undefined, 'editor-1');
    const marked = async (variables: Record<string, string>) => {
      const target = { dashboardId: id, version: 1, variables };
      const [markers] = (await services.dashboards.runPanel(target, 'orders', 'editor')).markers;
      expect(markers?.error).toBeNull();
      return new Set(markers?.points.map((point) => point.text));
    };
    expect(await marked({})).toEqual(new Set(['checkout-svc']));
    expect(await marked({ service: 'payments-svc' })).toEqual(new Set(['payments-svc']));
  });
});
