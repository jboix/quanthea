import { describe, expect, test } from 'bun:test';
import type { ConnectorLookup } from './check-queries.ts';
import { validateSpec } from './validate.ts';

const guardrails = { timeoutMs: 10_000, maxRows: 50_000, maxRangeDays: 90 };

/** The dev connectors, as the validator sees them. */
const lookup: ConnectorLookup = (name) =>
  ({
    'prometheus-dev': { language: 'promql', guardrails },
    'postgres-orders': { language: 'sql', guardrails: { ...guardrails, maxRangeDays: 1 } },
    'events-file': {
      notInstalled: 'The plugin that adds the kind "events-file" is not installed.',
    },
  })[name] as ReturnType<ConnectorLookup>;

const now = Date.parse('2026-09-28T12:00:00Z');

/**
 * A valid spec: a stat, a chart with deploy markers, and a table.
 *
 * @returns A fresh copy.
 */
function validSpec() {
  return {
    specVersion: 1,
    title: 'Checkout incident',
    time: { from: 'now-6h', to: 'now' },
    variables: [
      { kind: 'custom', name: 'env', options: ['prod', 'staging'], default: 'prod' },
      {
        kind: 'custom',
        name: 'services',
        options: ['checkout-svc', 'payments-svc'],
        default: ['checkout-svc'],
        multi: true,
      },
    ],
    annotations: [
      {
        id: 'deploys',
        label: 'deploy',
        query: {
          refId: 'D',
          connector: 'postgres-orders',
          language: 'sql',
          sql: 'SELECT deployed_at AS time, service AS text FROM deploys WHERE deployed_at BETWEEN :__from AND :__to',
        },
        timeField: 'time',
        textField: 'text',
      },
    ],
    panels: [
      {
        id: 'error-rate',
        title: 'Error rate',
        grid: { x: 0, y: 0, w: 4, h: 3 },
        queries: [
          {
            refId: 'A',
            connector: 'prometheus-dev',
            language: 'promql',
            expr: 'sum(rate(http_requests_total{env="$env",service=~"$services"}[$__rate_interval]))',
          },
        ],
        view: {
          kind: 'stat',
          ref: 'A',
          reduce: 'max',
          format: { $fmt: 'percent' },
          compare: { ref: 'A', reduce: 'first', label: 'baseline' },
        },
      },
      {
        id: 'by-service',
        title: 'By service',
        grid: { x: 0, y: 3, w: 12, h: 7 },
        queries: [
          {
            refId: 'A',
            connector: 'prometheus-dev',
            language: 'promql',
            expr: 'sum by (service) (rate(http_requests_total[1m]))',
            step: '1m',
          },
        ],
        view: {
          kind: 'chart',
          datasets: [{ ref: 'A' }],
          markers: [{ annotation: 'deploys' }],
          option: {
            xAxis: { type: 'time' },
            yAxis: { type: 'value', axisLabel: { formatter: { $fmt: 'percent' } } },
            series: [{ type: 'line' }],
          },
        },
      },
      {
        id: 'failed-orders',
        title: 'Failed orders',
        grid: { x: 4, y: 0, w: 4, h: 3 },
        queries: [
          {
            refId: 'A',
            connector: 'postgres-orders',
            language: 'sql',
            sql: "SELECT count(*) AS failed FROM orders WHERE status = 'failed' AND created_at BETWEEN :__from AND :__to",
          },
        ],
        view: { kind: 'table', ref: 'A', columns: [{ field: 'failed' }] },
      },
    ],
  };
}

/** A spec as the tests change it. */
type Spec = ReturnType<typeof validSpec> & Record<string, unknown>;

/**
 * The issues of a changed spec.
 *
 * @param change - Changes a valid spec in place.
 * @returns The issues, as `path: message` lines.
 */
function issuesAfter(change: (spec: Spec) => void): string[] {
  const spec = validSpec() as Spec;
  change(spec);
  const result = validateSpec(spec, { lookup, now: now });
  return result.ok ? [] : result.issues.map((issue) => `${issue.path}: ${issue.message}`);
}

/**
 * Sets a value deep in a spec, or deletes it when the value is `undefined`.
 *
 * @param target - The spec.
 * @param path - Dotted keys, such as `panels.0.view.ref`.
 * @param value - The new value.
 */
function set(target: object, path: string, value: unknown): void {
  const keys = path.split('.');
  const last = keys.pop() ?? '';
  const parent = keys.reduce(
    (node, key) => node[key] as Record<string, unknown>,
    target as Record<string, unknown>,
  );
  if (value === undefined) delete parent[last];
  else parent[last] = value;
}

describe('validateSpec', () => {
  test('accepts a valid spec', () => {
    expect(issuesAfter(() => undefined)).toEqual([]);
  });

  test('reports schema issues with bracketed paths', () => {
    expect(issuesAfter((spec) => set(spec, 'panels.1.view.ref', 'A'))).toEqual([
      expect.stringContaining('panels[1].view'),
    ]);
  });

  test('reports unknown refIds, markers and duplicate ids', () => {
    expect(
      issuesAfter((spec) => {
        set(spec, 'panels.0.view.compare.ref', 'B');
        set(spec, 'panels.1.view.markers', [{ annotation: 'releases' }]);
        set(spec, 'panels.2.id', 'error-rate');
      }),
    ).toEqual([
      'panels[2].id: "error-rate" is used twice.',
      'panels[0].view.compare.ref: Unknown refId "B".',
      'panels[1].view.markers[0].annotation: Unknown annotation "releases".',
    ]);
  });

  test('reports defaults outside the options and broken patterns', () => {
    expect(
      issuesAfter((spec) => {
        Object.assign(spec.variables[0] ?? {}, { default: 'dev' });
        spec.variables.push({ kind: 'text', name: 'order', default: 'x', pattern: '(' } as never);
      }),
    ).toEqual([
      'variables[0].default: "dev" is not one of the options.',
      'variables[2].pattern: The pattern is not a valid regular expression.',
    ]);
  });

  test('reports a pattern that can backtrack for exponential time, and a long text default', () => {
    expect(
      issuesAfter((spec) => {
        const text = { kind: 'text', name: 'order', default: 'aab', pattern: '(a+)+b' };
        spec.variables.push(text as never);
        spec.variables.push({ kind: 'text', name: 'note', default: 'x'.repeat(101) } as never);
      }),
    ).toEqual([
      'variables[2].pattern: The pattern repeats a group that holds a quantifier or an alternation, or refers back to a group, which can take exponential time. Write it without, such as [a-z0-9-]+.',
      'variables[3].default: A text value is at most 100 characters.',
    ]);
  });

  test('keeps chart options to the allowlist, with no inlined data or long strings', () => {
    expect(
      issuesAfter((spec) => {
        set(spec, 'panels.1.view.option.dataset', { source: [[1, 2]] });
        set(spec, 'panels.1.view.option.series', [{ type: 'custom', data: [1, 2] }]);
        set(spec, 'panels.1.view.option.tooltip', {
          renderMode: 'html',
          formatter: 'x'.repeat(501),
        });
        set(spec, 'panels.1.view.option.yAxis.axisLabel.formatter', { $fmt: 'bytes', base: 3 });
      }),
    ).toEqual([
      'panels[1].view.option.yAxis.axisLabel.formatter: Not a valid named formatter.',
      'panels[1].view.option.series[0].type: Series type "custom" is not supported.',
      'panels[1].view.option.series[0].data: Data comes from the queries, never inlined.',
      'panels[1].view.option.dataset: "dataset" is not allowed in a chart option.',
      'panels[1].view.option.tooltip.renderMode: The renderer sets this.',
      'panels[1].view.option.tooltip.formatter: Strings are at most 500 characters.',
    ]);
  });

  test('refuses links and click events anywhere in a chart option', () => {
    expect(
      issuesAfter((spec) => {
        set(spec, 'panels.1.view.option.title', {
          text: 'Session expired, click to sign in again',
          link: 'https://evil.example/',
          target: 'self',
          sublink: 'https://evil.example/',
          subtarget: 'self',
          triggerEvent: true,
        });
        set(spec, 'panels.1.view.option.legend', { data: [{ name: 'a', link: 'x' }] });
        set(spec, 'panels.1.view.option.axisPointer', { link: [{ xAxisIndex: 'all' }] });
      }),
    ).toEqual([
      'panels[1].view.option.title.link: Charts never open links or emit click events.',
      'panels[1].view.option.title.target: Charts never open links or emit click events.',
      'panels[1].view.option.title.sublink: Charts never open links or emit click events.',
      'panels[1].view.option.title.subtarget: Charts never open links or emit click events.',
      'panels[1].view.option.title.triggerEvent: Charts never open links or emit click events.',
      'panels[1].view.option.legend.data[0].link: Charts never open links or emit click events.',
    ]);
  });

  test('refuses a list of links outside axisPointer, and nodes that open a link', () => {
    const levels = [{}, { link: ['https://evil.example/'] }];
    expect(
      issuesAfter((spec) => {
        set(spec, 'panels.1.view.option.title', { text: 'A', link: ['https://evil.example/'] });
        set(spec, 'panels.1.view.option.series', [
          { type: 'sunburst', nodeClick: 'link', link: ['https://evil.example/'], levels },
          { type: 'treemap', nodeClick: 'zoomToNode' },
        ]);
      }),
    ).toEqual([
      'panels[1].view.option.series[0].nodeClick: Charts never open links or emit click events.',
      'panels[1].view.option.series[0].link: Charts never open links or emit click events.',
      'panels[1].view.option.series[0].levels[1].link: Charts never open links or emit click events.',
      'panels[1].view.option.title.link: Charts never open links or emit click events.',
    ]);
  });

  test('says a connector whose plugin is gone is not installed', () => {
    expect(
      issuesAfter((spec) => {
        set(spec, 'panels.0.queries.0.connector', 'events-file');
      }),
    ).toEqual([
      'panels[0].queries[0].connector: The plugin that adds the kind "events-file" is not installed.',
    ]);
  });

  test('checks connectors, languages and variables by binding the queries', () => {
    expect(
      issuesAfter((spec) => {
        set(spec, 'panels.0.queries.0.connector', 'prometheus-prod');
        set(spec, 'panels.1.queries.0.expr', 'sum(rate(http_requests_total{env="$region"}[1m]))');
        set(spec, 'panels.2.queries.0.language', 'promql');
        set(spec, 'panels.2.queries.0.expr', 'up');
        set(spec, 'panels.2.queries.0.sql', undefined);
      }),
    ).toEqual([
      'panels[0].queries[0].connector: No connector is named "prometheus-prod".',
      'panels[1].queries[0].expr: Unknown variable $region.',
      'panels[2].queries[0].language: "postgres-orders" runs sql, not promql.',
    ]);
  });

  test('takes an interval variable in a range and as the step, from its options only', () => {
    const withInterval = (spec: ReturnType<typeof validSpec>) => {
      spec.variables.push({
        kind: 'interval',
        name: 'interval',
        options: ['1m', '5m'],
        default: '5m',
      } as never);
      set(spec, 'panels.1.queries.0.expr', 'sum(rate(http_requests_total[$interval]))');
      set(spec, 'panels.1.queries.0.step', '$interval');
    };
    expect(issuesAfter(withInterval)).toEqual([]);
    expect(
      issuesAfter((spec) => {
        withInterval(spec);
        Object.assign(spec.variables[2] ?? {}, { default: '15m' });
        set(spec, 'panels.0.queries.0.step', '$env');
      }),
    ).toEqual([
      'variables[2].default: "15m" is not one of the options.',
      'panels[0].queries[0].expr: The step takes a duration or an interval variable.',
    ]);
  });

  test('catches a multi-value variable where one value fits, and a write statement', () => {
    expect(
      issuesAfter((spec) => {
        set(spec, 'panels.0.queries.0.expr', 'up{service="$services"}');
        set(spec, 'panels.2.queries.0.sql', 'DELETE FROM orders');
      }),
    ).toEqual([
      'panels[0].queries[0].expr: $services has several values; match it with =~ instead of =.',
      'panels[2].queries[0].sql: A query starts with SELECT, WITH, VALUES or TABLE.',
    ]);
  });

  test('checks the default range against every connector used, and its direction', () => {
    expect(
      issuesAfter((spec) => Object.assign(spec, { time: { from: 'now-2d', to: 'now' } })),
    ).toEqual([
      'time: postgres-orders: The time range is longer than this connector allows (1 days).',
    ]);
    expect(
      issuesAfter((spec) => Object.assign(spec, { time: { from: 'now', to: 'now-1h' } })),
    ).toContain('time: The time range ends before it starts.');
  });

  test('checks the time zone', () => {
    expect(issuesAfter((spec) => Object.assign(spec, { timezone: 'Mars/Olympus' }))).toEqual([
      'timezone: Unknown time zone "Mars/Olympus".',
    ]);
  });

  test('moves overlapping panels down instead of failing', () => {
    const spec = validSpec();
    Object.assign(spec.panels[2]?.grid ?? {}, { x: 2, y: 0 });
    const result = validateSpec(spec, { lookup, now });
    expect(result.ok && result.spec.panels.map((item) => item.grid)).toEqual([
      { x: 0, y: 0, w: 4, h: 3 },
      { x: 0, y: 6, w: 12, h: 7 },
      { x: 2, y: 3, w: 4, h: 3 },
    ]);
  });
});
