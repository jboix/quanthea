import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type {
  ConnectorError,
  ConnectorInstance,
  ExecutionContext,
  LogqlQuery,
} from '../_shared/index.ts';
import { testConnectorConformance } from '../_shared/test/conformance.ts';
import { devIncidentStart, devLoki, integrationFor } from '../_shared/test/dev-sources.ts';
import { lokiConnector } from './loki-connector.ts';

const live = integrationFor('loki');
const incident = devIncidentStart();
const timeRange = {
  from: new Date(incident.getTime() - 30 * 60_000),
  to: new Date(incident.getTime() + 60 * 60_000),
};

/**
 * A bound LogQL query over the incident.
 *
 * @param expr - The expression.
 * @param options - Whether it is instant, and its step.
 * @returns The query.
 */
function logql(
  expr: string,
  options: { instant?: boolean; stepSeconds?: number } = {},
): LogqlQuery {
  return {
    language: 'logql',
    expr,
    instant: options.instant ?? false,
    stepSeconds: options.stepSeconds ?? 60,
  };
}

/**
 * An execution context over the incident.
 *
 * @param overrides - Fields to replace.
 * @returns The context.
 */
function context(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    refId: 'A',
    signal: AbortSignal.timeout(20_000),
    timeoutMs: 20_000,
    maxRows: 1000,
    timeRange,
    ...overrides,
  };
}

testConnectorConformance(lokiConnector, {
  config: devLoki.config,
  secret: devLoki.secret,
  query: logql('sum by (level) (count_over_time({service="checkout-svc"}[5m]))', {
    stepSeconds: 300,
  }),
  invalidQuery: logql('{service="checkout-svc"'),
  sampleField: { entity: 'logs', field: 'service' },
  timeRange,
  live,
});

describe.skipIf(!live)('loki connector against the dev Loki', () => {
  let connection: ConnectorInstance;

  beforeAll(() => {
    connection = lokiConnector.open({
      config: lokiConnector.configSchema.parse(devLoki.config),
      secret: lokiConnector.secretSchema.parse(devLoki.secret),
    });
  });

  afterAll(() => connection.close());

  test('names the server', async () => {
    const health = await connection.test(AbortSignal.timeout(20_000));
    expect(health).toMatchObject({ ok: true, readOnly: null });
    expect(health.message).toMatch(/^Loki \d+\.\d+/);
  });

  test('gives the lines of a log query as a table, newest first, with the parsed labels', async () => {
    const [frame] = await connection.execute(
      logql('{service="checkout-svc", level="error"} | json | status >= 500'),
      context(),
    );
    const names = frame?.fields.map((field) => field.name) ?? [];
    expect(names.slice(0, 2)).toEqual(['time', 'line']);
    expect(names).toContain('route');
    const times = frame?.values[0] as number[];
    expect(times.length).toBeGreaterThan(20);
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    expect(
      times.every((time) => time >= timeRange.from.getTime() && time <= timeRange.to.getTime()),
    ).toBe(true);
  });

  test('gives a metric query as series, with the incident peaking after the deploy', async () => {
    const frames = await connection.execute(
      logql('sum(count_over_time({service="checkout-svc", level="error"}[5m]))', {
        stepSeconds: 300,
      }),
      context(),
    );
    expect(frames).toHaveLength(1);
    const [times, counts] = (frames[0]?.values ?? [[], []]) as [number[], number[]];
    const peak = times[counts.indexOf(Math.max(...counts))] ?? 0;
    const minutes = (peak - incident.getTime()) / 60_000;
    expect(minutes).toBeGreaterThanOrEqual(10);
    expect(minutes).toBeLessThanOrEqual(30);
  });

  test('answers an instant query with one table of samples', async () => {
    const [frame] = await connection.execute(
      logql('sum by (service) (count_over_time({env="prod"}[1h]))', { instant: true }),
      context(),
    );
    expect(frame?.fields.map((field) => field.name)).toEqual(['service', 'Value']);
    expect(frame?.meta.rowCount).toBe(4);
  });

  test('stops at the row limit', async () => {
    const [frame] = await connection.execute(
      logql('{service="catalog-svc"}'),
      context({ maxRows: 10 }),
    );
    expect(frame?.meta).toMatchObject({ rowCount: 10, truncated: true });
  });

  test('describes the labels and the fields Loki detects, and samples both', async () => {
    const snapshot = await connection.describe(AbortSignal.timeout(20_000));
    const [logs] = snapshot.entities;
    expect(logs?.name).toBe('logs');
    expect(logs?.rowEstimate).toBeGreaterThan(10_000);
    const fields = Object.fromEntries((logs?.fields ?? []).map((field) => [field.name, field]));
    expect(fields.service).toMatchObject({ nativeType: 'stream label', distinctEstimate: 4 });
    expect(fields.route?.nativeType).toBe('json string');
    expect(fields.duration_ms?.type).toBe('number');
    const services = await connection.sampleValues(
      { entity: 'logs', field: 'service' },
      10,
      AbortSignal.timeout(20_000),
    );
    expect([...services.values].sort()).toEqual([
      'cart-svc',
      'catalog-svc',
      'checkout-svc',
      'payments-svc',
    ]);
    const routes = await connection.sampleValues(
      { entity: 'logs', field: 'route' },
      20,
      AbortSignal.timeout(20_000),
    );
    expect(routes.values).toContain('POST /checkout/confirm');
    const injected = await connection
      .sampleValues(
        { entity: 'logs', field: 'service/../../ready' },
        10,
        AbortSignal.timeout(20_000),
      )
      .catch((error: unknown) => error as ConnectorError);
    expect(injected).toMatchObject({ code: 'not_found' });
  });

  test('reports a syntax error without the literals of the query', async () => {
    const failure = await connection.execute(logql('{service="secret-value"} |= '), context()).then(
      () => undefined,
      (error: unknown) => error as ConnectorError,
    );
    expect(failure).toMatchObject({ code: 'syntax' });
    expect(failure?.safeMessage).not.toContain('secret-value');
  });
});
