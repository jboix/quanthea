import { describe, expect, test } from 'bun:test';
import { prometheusConnector } from './prometheus-connector.ts';

/**
 * Opens a Prometheus connector on an address nothing listens on.
 *
 * @param config - Configuration fields to add.
 * @param secret - The credentials.
 * @returns The connection.
 */
function open(config: Record<string, unknown>, secret: Record<string, unknown>) {
  return prometheusConnector.open({
    config: prometheusConnector.configSchema.parse({ url: 'http://127.0.0.1:1', ...config }),
    secret: prometheusConnector.secretSchema.parse(secret),
  });
}

describe('prometheus connector credentials', () => {
  test('reports incomplete bearer credentials instead of sending a request', async () => {
    const connection = open({ auth: 'bearer' }, {});
    expect(await connection.test(AbortSignal.timeout(1000))).toMatchObject({
      ok: false,
      message: 'Bearer authentication needs a token.',
    });
    await expect(
      connection.execute(
        { language: 'promql', expr: 'up', instant: true, stepSeconds: 15 },
        {
          refId: 'A',
          signal: AbortSignal.timeout(1000),
          timeoutMs: 1000,
          maxRows: 10,
          timeRange: { from: new Date(0), to: new Date(1) },
        },
      ),
    ).rejects.toMatchObject({ code: 'authentication' });
  });

  test('reports incomplete basic credentials', async () => {
    const report = await open({ auth: 'basic', username: 'reader' }, {}).test(
      AbortSignal.timeout(1000),
    );
    expect(report.message).toBe('Basic authentication needs a username and a password.');
  });

  test('accepts only http and https URLs', () => {
    expect(prometheusConnector.configSchema.safeParse({ url: 'file:///etc/passwd' }).success).toBe(
      false,
    );
    expect(
      prometheusConnector.configSchema.safeParse({ url: 'https://prometheus.internal' }).success,
    ).toBe(true);
  });
});

describe('prometheus connector target', () => {
  test('is the URL without the credentials it may carry', () => {
    const config = prometheusConnector.configSchema.parse({ url: 'https://ops:pw@prom.example/' });
    expect(prometheusConnector.describeTarget?.(config)).toBe('https://prom.example/');
  });
});
