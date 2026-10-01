import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { testConnectorConformance } from '@quanthea/plugin-kit/testing';
import type {
  ConnectorError,
  ConnectorInstance,
  ExecutionContext,
  RedisQuery,
} from '../_shared/index.ts';
import {
  devIncidentStart,
  devValkey,
  devValkeyOwner,
  integrationFor,
} from '../_shared/test/dev-sources.ts';
import { valkeyConnector } from './valkey-connector.ts';

const live = integrationFor('valkey');
const incident = devIncidentStart();
const timeRange = {
  from: new Date(incident.getTime() - 30 * 60_000),
  to: new Date(incident.getTime() + 60 * 60_000),
};

/**
 * A bound command.
 *
 * @param command - The command.
 * @param args - Its arguments.
 * @returns The query.
 */
function redis(command: string, ...args: string[]): RedisQuery {
  return { language: 'redis', command, args };
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
    signal: AbortSignal.timeout(10_000),
    timeoutMs: 10_000,
    maxRows: 1000,
    timeRange,
    ...overrides,
  };
}

/**
 * Opens the dev Valkey.
 *
 * @param source - The configuration and secret.
 * @returns The connection.
 */
function open(source: { config: unknown; secret: unknown }): ConnectorInstance {
  return valkeyConnector.open({
    config: valkeyConnector.configSchema.parse(source.config),
    secret: valkeyConnector.secretSchema.parse(source.secret),
  });
}

testConnectorConformance(valkeyConnector, {
  config: devValkey.config,
  secret: devValkey.secret,
  query: redis('ZREVRANGE', 'errors:by_reason', '0', '-1', 'WITHSCORES'),
  invalidQuery: redis('HGETALL', 'errors:by_reason'),
  sampleField: { entity: 'service:*', field: 'key' },
  timeRange,
  live,
});

describe.skipIf(!live)('valkey connector against the dev Valkey', () => {
  let reader: ConnectorInstance;
  let owner: ConnectorInstance;

  beforeAll(() => {
    reader = open(devValkey);
    owner = open(devValkeyOwner);
  });

  afterAll(async () => {
    await reader.close();
    await owner.close();
  });

  /**
   * Runs a command and returns its frame.
   *
   * @param connection - The connection.
   * @param query - The command.
   * @returns The frame.
   */
  async function frameOf(connection: ConnectorInstance, query: RedisQuery) {
    const [frame] = await connection.execute(query, context());
    if (!frame) throw new Error('No frame.');
    return frame;
  }

  test('names the server and says whether the user could write', async () => {
    const health = await reader.test(AbortSignal.timeout(10_000));
    expect(health).toMatchObject({ ok: true, readOnly: true });
    expect(health.message).toMatch(/^Valkey \d+\.\d+\.\d+\. User dash_ro cannot write\.$/);
    expect(await owner.test(AbortSignal.timeout(10_000))).toMatchObject({
      ok: true,
      readOnly: false,
    });
  });

  test('reads a stream over the time range, with its time and fields, and the incident in it', async () => {
    const frame = await frameOf(
      reader,
      redis(
        'XRANGE',
        'checkout:requests',
        String(timeRange.from.getTime()),
        String(timeRange.to.getTime()),
      ),
    );
    expect(frame.fields).toEqual([
      { name: 'id', type: 'string' },
      { name: 'time', type: 'time' },
      { name: 'requests', type: 'number' },
      { name: 'errors', type: 'number' },
    ]);
    const [, times, , errors] = frame.values as [string[], number[], number[], number[]];
    const peak = times[errors.indexOf(Math.max(...errors))] ?? 0;
    const minutes = (peak - incident.getTime()) / 60_000;
    expect(minutes).toBeGreaterThanOrEqual(10);
    expect(minutes).toBeLessThanOrEqual(20);
  });

  test('turns hashes, several keys and server information into tables', async () => {
    const hash = await frameOf(reader, redis('HGETALL', 'service:checkout-svc'));
    expect(hash.values[0]).toEqual(['tier', 'peak_rps', 'routes']);
    const keys = await frameOf(reader, redis('MGET', 'orders:failed:total', 'nope'));
    expect(keys.fields).toEqual([
      { name: 'key', type: 'string' },
      { name: 'value', type: 'number' },
    ]);
    expect(keys.values[1]?.[1]).toBeNull();
    const info = await frameOf(reader, redis('INFO', 'server'));
    expect(info.values[1]).toContain('valkey_version');
  });

  test('stops at the row limit', async () => {
    const [frame] = await reader.execute(
      redis('XRANGE', 'checkout:requests', '-', '+'),
      context({ maxRows: 10 }),
    );
    expect(frame?.meta).toMatchObject({ rowCount: 10, truncated: true });
  });

  test('refuses commands that write, even with a user that could run them', async () => {
    for (const query of [
      redis('SET', 'x', '1'),
      redis('KEYS', '*'),
      redis('EVAL', 'return 1', '0'),
    ]) {
      const failure = await owner.execute(query, context()).then(
        () => undefined,
        (error: unknown) => error as ConnectorError,
      );
      expect(failure).toMatchObject({ code: 'rejected' });
    }
    const wrongType = await reader.execute(redis('GET', 'service:checkout-svc'), context()).then(
      () => undefined,
      (error: unknown) => error as ConnectorError,
    );
    expect(wrongType).toMatchObject({
      code: 'syntax',
      safeMessage: 'The key holds another type than the command reads.',
    });
  });

  test('describes key patterns with their types and fields', async () => {
    const snapshot = await reader.describe(AbortSignal.timeout(10_000));
    const byName = Object.fromEntries(snapshot.entities.map((entity) => [entity.name, entity]));
    expect(byName['service:*']?.description).toBe('4 hash keys, such as service:cart-svc.');
    expect(byName['service:*']?.fields.map((field) => field.name)).toEqual([
      'peak_rps',
      'routes',
      'tier',
    ]);
    expect(byName.deploys?.fields.map((field) => field.name)).toEqual([
      'id',
      'time',
      'id',
      'service',
      'version',
      'author',
    ]);
    expect(byName['errors:*']).toMatchObject({
      description: '2 zset keys, such as errors:by_reason.',
    });
    expect(byName['errors:*']?.fields.map((field) => field.name)).toEqual(['member', 'score']);
  });

  test('samples keys, hash fields and members', async () => {
    const signal = AbortSignal.timeout(10_000);
    const keys = await reader.sampleValues({ entity: 'service:*', field: 'key' }, 10, signal);
    expect([...keys.values].sort()).toEqual([
      'service:cart-svc',
      'service:catalog-svc',
      'service:checkout-svc',
      'service:payments-svc',
    ]);
    const tiers = await reader.sampleValues({ entity: 'service:*', field: 'tier' }, 10, signal);
    expect([...tiers.values].sort()).toEqual(['critical', 'standard']);
    const reasons = await reader.sampleValues(
      { entity: 'errors:by_reason', field: 'member' },
      10,
      signal,
    );
    expect(reasons.values).toHaveLength(4);
  });
});
