import { afterAll, describe, expect, test } from 'bun:test';
import type { Frame } from '@querent/shared';
import {
  devIncidentStart,
  devLoki,
  integrationFor,
} from '../../connectors/_shared/test/dev-sources.ts';
import { lokiConnector } from '../../connectors/loki/loki-connector.ts';
import { bindTemplate } from '../../query/bind.ts';
import type { Variables } from '../../query/variables.ts';
import { buildData } from './build.ts';
import { dataSchema } from './request.ts';

const incident = devIncidentStart();
const timeRange = {
  from: new Date(incident.getTime() - 30 * 60_000),
  to: new Date(incident.getTime() + 60 * 60_000),
};

describe.skipIf(!integrationFor('loki'))('the LogQL builders on the dev Loki', () => {
  const connection = lokiConnector.open({
    config: lokiConnector.configSchema.parse(devLoki.config),
    secret: lokiConnector.secretSchema.parse(devLoki.secret),
  });
  afterAll(() => connection.close());

  /**
   * Builds a request, binds it and runs it over the incident.
   *
   * @param data - The request, without its connector.
   * @param variables - The variable values.
   * @returns The frames.
   */
  async function run(data: Record<string, unknown>, variables: Variables = {}): Promise<Frame[]> {
    const [query] = buildData(dataSchema.parse({ connector: 'loki', ...data })).queries;
    if (!query) throw new Error('Nothing was built.');
    const bound = bindTemplate(query, variables, timeRange);
    const signal = AbortSignal.timeout(20_000);
    const execution = { refId: 'A', signal, timeoutMs: 20_000, maxRows: 5000, timeRange };
    return connection.execute(bound, execution);
  }

  /**
   * The time of the largest value of a one-series result.
   *
   * @param frames - The frames.
   * @returns Milliseconds after the incident started.
   */
  function peakAfterIncident(frames: Frame[]): number {
    const [frame] = frames;
    const [times, values] = (frame?.values ?? [[], []]) as [number[], number[]];
    return (times[values.indexOf(Math.max(...values))] ?? 0) - incident.getTime();
  }

  test('counts the error lines of a service variable, peaking after the deploy', async () => {
    const frames = await run(
      {
        kind: 'logql-series',
        stream: [{ field: 'service', op: '=~', value: '$service' }],
        filters: [{ field: 'level', value: 'error' }],
        window: '5m',
      },
      { service: { value: ['checkout-svc'] } },
    );
    expect(peakAfterIncident(frames)).toBeGreaterThanOrEqual(5 * 60_000);
    expect(peakAfterIncident(frames)).toBeLessThanOrEqual(30 * 60_000);
  });

  test('reads the p95 duration from the lines, and the error share by service', async () => {
    const p95 = await run({
      kind: 'logql-series',
      stream: [{ field: 'service', value: 'checkout-svc' }],
      parser: 'json',
      measure: { fn: 'quantile', field: 'duration_ms', quantile: 0.95 },
      window: '5m',
    });
    expect(p95).toHaveLength(1);
    expect(peakAfterIncident(p95)).toBeGreaterThanOrEqual(0);
    const shares = await run({
      kind: 'logql-ratio',
      stream: [{ field: 'env', value: 'prod' }],
      match: [{ field: 'level', value: 'error' }],
      by: ['service'],
      over: 'range',
    });
    const [frame] = shares;
    const services = frame?.values[frame.fields.findIndex((field) => field.name === 'service')];
    const values = frame?.values[frame.fields.findIndex((field) => field.name === 'Value')];
    const worst = (services as string[])[
      (values as number[]).indexOf(Math.max(...(values as number[])))
    ];
    expect(worst).toBe('checkout-svc');
  });

  test('ranks, counts and lists lines', async () => {
    const [top] = await run({
      kind: 'logql-breakdown',
      stream: [{ field: 'env', value: 'prod' }],
      filters: [{ field: 'level', value: 'error' }],
      by: ['service'],
      limit: 2,
    });
    expect(top?.meta.rowCount).toBe(2);
    const [stat] = await run({
      kind: 'logql-stat',
      stream: [{ field: 'service', value: 'checkout-svc' }],
      filters: [{ field: 'level', value: 'error' }],
    });
    expect(stat?.values.at(-1)?.[0]).toBeGreaterThan(0);
    const [lines] = await run({
      kind: 'logql-lines',
      stream: [{ field: 'service', value: 'checkout-svc' }],
      parser: 'json',
      filters: [{ field: 'status', op: '=~', value: '5..' }],
    });
    expect(lines?.fields.slice(0, 2).map((field) => field.name)).toEqual(['time', 'line']);
    expect(lines?.meta.rowCount).toBeGreaterThan(0);
  });
});
