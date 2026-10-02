import { describe, expect, test } from 'bun:test';
import { dashboardSpecSchema } from './dashboard.ts';

/** The example from docs/dashboard-spec.md, abbreviated to three panels. */
const example = {
  specVersion: 1,
  title: 'Checkout incident · 26 Sep',
  description: 'Error rate, latency and failed orders for checkout around deploy #481.',
  time: { from: '2026-09-26T13:30:00+02:00', to: '2026-09-26T15:00:00+02:00' },
  variables: [{ kind: 'custom', name: 'env', options: ['prod', 'staging'], default: 'prod' }],
  annotations: [
    {
      id: 'deploys',
      label: 'deploy',
      color: '@ink',
      query: {
        refId: 'D',
        connector: 'postgres-orders',
        language: 'sql',
        sql: "SELECT deployed_at AS time, 'deploy #' || id AS text FROM deploys WHERE deployed_at BETWEEN :__from AND :__to",
      },
      timeField: 'time',
      textField: 'text',
    },
  ],
  panels: [
    {
      id: 'error-rate-peak',
      title: 'Error rate · peak',
      grid: { x: 0, y: 0, w: 4, h: 3 },
      queries: [
        {
          refId: 'A',
          connector: 'prometheus-prod',
          language: 'promql',
          expr: 'sum(rate(http_requests_total{env="$env",code=~"5.."}[1m])) / sum(rate(http_requests_total{env="$env"}[1m]))',
        },
      ],
      view: {
        kind: 'stat',
        ref: 'A',
        reduce: 'max',
        format: { $fmt: 'percent', decimals: 1, input: 'ratio' },
        compare: { ref: 'A', reduce: 'first', label: 'baseline' },
      },
    },
    {
      id: 'error-rate-by-service',
      title: 'Error rate by service, 1m',
      grid: { x: 0, y: 3, w: 12, h: 7 },
      queries: [
        {
          refId: 'A',
          connector: 'prometheus-prod',
          language: 'promql',
          step: '1m',
          expr: 'sum by (service) (rate(http_requests_total{env="$env",code=~"5.."}[1m]))',
        },
      ],
      view: {
        kind: 'chart',
        datasets: [{ ref: 'A' }],
        markers: [{ annotation: 'deploys' }],
        option: {
          xAxis: { type: 'time' },
          yAxis: {
            type: 'value',
            axisLabel: { formatter: { $fmt: 'percent', decimals: 1, input: 'ratio' } },
          },
          tooltip: { trigger: 'axis' },
          series: [{ type: 'line', showSymbol: false }],
        },
      },
    },
    {
      id: 'slowest-endpoints',
      title: 'Slowest endpoints',
      grid: { x: 6, y: 10, w: 6, h: 5 },
      queries: [
        {
          refId: 'A',
          connector: 'prometheus-prod',
          language: 'promql',
          instant: true,
          expr: 'topk(10, histogram_quantile(0.95, sum by (le, route) (rate(http_request_duration_seconds_bucket{env="$env"}[$__range]))))',
        },
      ],
      view: {
        kind: 'table',
        ref: 'A',
        columns: [
          { field: 'route', label: 'Endpoint' },
          { field: 'Value', label: 'p95', format: { $fmt: 'duration', unit: 's' }, align: 'right' },
        ],
        sort: { field: 'Value', dir: 'desc' },
      },
    },
  ],
};

/**
 * The example with one change.
 *
 * @param change - Changes the copy in place.
 * @returns The changed copy.
 */
function changed(change: (spec: typeof example & Record<string, unknown>) => void) {
  const copy = structuredClone(example) as typeof example & Record<string, unknown>;
  change(copy);
  return copy;
}

/**
 * The paths of the issues a spec raises.
 *
 * @param spec - The spec.
 * @returns The dotted paths.
 */
function issuePaths(spec: unknown): string[] {
  const parsed = dashboardSpecSchema.safeParse(spec);
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.path.join('.'));
}

describe('dashboardSpecSchema', () => {
  test('accepts the example from the spec document', () => {
    expect(issuePaths(example)).toEqual([]);
  });

  test('fills empty variables and annotations', () => {
    const { variables: _variables, annotations: _annotations, ...bare } = example;
    expect(dashboardSpecSchema.parse(bare)).toMatchObject({ variables: [], annotations: [] });
  });

  test('takes a marker colour from the theme tokens only', () => {
    const colored = (color: string) =>
      changed((spec) => Object.assign(spec.annotations[0] ?? {}, { color }));
    expect(issuePaths(colored('@palette.3'))).toEqual([]);
    expect(issuePaths(colored('#ff0000'))).toEqual(['annotations.0.color']);
    expect(issuePaths(colored('red; background: url(x)'))).toEqual(['annotations.0.color']);
  });

  test('refuses keys it does not know, so nothing rides along', () => {
    expect(issuePaths(changed((spec) => Object.assign(spec, { script: 'alert(1)' })))).toEqual([
      '',
    ]);
    const inView = changed((spec) => Object.assign(spec.panels[0]?.view ?? {}, { html: '<b>' }));
    expect(issuePaths(inView)).toEqual(['panels.0.view']);
  });

  test('refuses a chart option that is not plain JSON', () => {
    const withFunction = changed((spec) => {
      const view = spec.panels[1]?.view as { option: Record<string, unknown> };
      view.option.tooltip = { formatter: () => 'x' };
    });
    expect(issuePaths(withFunction)).toEqual(['panels.1.view.option.tooltip']);
  });

  test('checks names, grid bounds and query limits', () => {
    expect(
      issuePaths(changed((spec) => Object.assign(spec.panels[0] ?? {}, { id: 'Bad Id' }))),
    ).toEqual(['panels.0.id']);
    const tooWide = changed((spec) => Object.assign(spec.panels[0]?.grid ?? {}, { x: 10, w: 4 }));
    expect(issuePaths(tooWide)).toEqual(['panels.0.grid']);
    const noQueries = changed((spec) => Object.assign(spec.panels[0] ?? {}, { queries: [] }));
    expect(issuePaths(noQueries)).toEqual(['panels.0.queries']);
    const badStep = changed((spec) =>
      Object.assign(spec.panels[1]?.queries[0] ?? {}, { step: '1 minute' }),
    );
    expect(issuePaths(badStep)).toEqual(['panels.1.queries.0.step']);
  });

  test('refuses a variable named like a built-in', () => {
    const builtIn = changed((spec) => Object.assign(spec.variables[0] ?? {}, { name: '__from' }));
    expect(issuePaths(builtIn)).toEqual(['variables.0.name']);
  });
});
