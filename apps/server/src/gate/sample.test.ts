import { describe, expect, test } from 'bun:test';
import type { AccessLevel, ObjectVisibility } from '@quanthea/shared';
import {
  ConnectorError,
  type ConnectorInstance,
  type ResolvedObject,
} from '../connectors/_shared/index.ts';
import { memoryConnector } from '../connectors/_shared/test/memory-connector.ts';
import { everythingShown, type ObjectScope, scopeOf } from '../query/scope/object-scope.ts';
import { sampleForModel } from './sample.ts';

const instance = memoryConnector.open({ config: { rowCount: 5 }, secret: { token: 't' } });
const service = { entity: 'events', field: 'service' };

/**
 * Samples a field at a level.
 *
 * @param accessLevel - The access level.
 * @param options - Hidden fields, the limit, and another instance.
 * @returns The model sample.
 */
function sampleAt(
  accessLevel: AccessLevel,
  options: {
    hiddenFields?: string[];
    limit?: number;
    from?: ConnectorInstance;
    scope?: ObjectScope;
    entity?: string;
  } = {},
) {
  const subject = {
    id: 'c-memory',
    name: 'memory',
    kind: 'memory',
    accessLevel,
    hiddenFields: options.hiddenFields ?? [],
    scope: options.scope ?? everythingShown,
    descriptions: {},
  };
  return sampleForModel(
    subject,
    options.from ?? instance,
    { ...service, entity: options.entity ?? service.entity },
    options.limit ?? 10,
    AbortSignal.timeout(1000),
  );
}

describe('sampleForModel', () => {
  test('refuses level 1', async () => {
    expect(await sampleAt(1)).toEqual({
      ok: false,
      error: 'Sample values need access level 2 or higher; memory is at level 1.',
    });
  });

  test('returns the values of a field with few of them from level 2', async () => {
    expect(await sampleAt(2)).toEqual({
      ok: true,
      values: ['checkout-svc', 'payments-svc', 'cart-svc'],
    });
  });

  test('refuses a hidden field at every level', async () => {
    expect(await sampleAt(4, { hiddenFields: ['events.service'] })).toEqual({
      ok: false,
      error: 'events.service is hidden.',
    });
  });

  test('refuses a field with more distinct values than asked for', async () => {
    expect(await sampleAt(2, { limit: 2 })).toEqual({
      ok: false,
      error: 'events.service has more than 2 distinct values.',
    });
  });

  test('never asks the source for more than 50 values', async () => {
    let asked = 0;
    const counting: ConnectorInstance = {
      ...instance,
      sampleValues: (_field, limit) => {
        asked = limit;
        return Promise.resolve({ values: [], complete: true });
      },
    };
    await sampleAt(2, { limit: 10_000, from: counting });
    expect(asked).toBe(50);
  });

  test('refuses a field of an object the connector does not show', async () => {
    const scope = scopeOf(
      { showSystem: false, mode: 'except', names: ['events'] },
      'sql',
      'postgres',
    );
    expect(await sampleAt(4, { scope })).toEqual({
      ok: false,
      error: 'memory does not show events.',
    });
  });

  test('gives only the safe message of a connector error', async () => {
    const failing: ConnectorInstance = {
      ...instance,
      sampleValues: () =>
        Promise.reject(
          new ConnectorError('not_found', 'Column "events.service" does not exist.', 'raw text'),
        ),
    };
    expect(await sampleAt(2, { from: failing })).toEqual({
      ok: false,
      error: 'Column "events.service" does not exist.',
    });
  });
});

/** What the fake search server holds. */
const cluster: readonly ResolvedObject[] = [
  { name: 'logs-app' },
  { name: 'logs-secret' },
  { name: 'security-auditlog-2026.10.12' },
  { name: 'all-logs', members: ['logs-app', 'logs-secret'] },
];

/**
 * Whether a glob covers a name, as the fake server expands it.
 *
 * @param pattern - The pattern.
 * @param name - The name.
 * @returns `true` when it does.
 */
function covers(pattern: string, name: string): boolean {
  const source = pattern.split('*').map((part) => part.replace(/[.+-]/g, '\\$&'));
  return new RegExp(`^${source.join('.*')}$`).test(name);
}

/**
 * Samples a field of a search connector, on a fake server.
 *
 * @param entity - The index expression the model names.
 * @param visibility - The connector's visibility; the default when not given.
 * @param resolves - Whether the kind can resolve an index expression.
 * @returns The model sample, and the entities the source was asked to sample.
 */
async function searchSample(
  entity: string,
  visibility: Partial<ObjectVisibility> = {},
  resolves = true,
) {
  const asked: string[] = [];
  const search: ConnectorInstance = {
    ...instance,
    sampleValues: (field) => {
      asked.push(field.entity);
      return Promise.resolve({ values: ['info'], complete: true });
    },
    ...(resolves && {
      resolveObjects: (expression: string) =>
        Promise.resolve(
          cluster.filter(({ name }) => expression.split(',').some((item) => covers(item, name))),
        ),
    }),
  };
  const scope = scopeOf({ showSystem: false, mode: 'except', names: [], ...visibility }, 'search');
  return { sample: await sampleAt(4, { from: search, scope, entity }), asked };
}

describe('sampleForModel on a search connector', () => {
  const hidden = { names: ['logs-secret'] };

  test('samples a pattern without the hidden indices it reaches', async () => {
    for (const pattern of ['logs-*', '*']) {
      const { sample, asked } = await searchSample(pattern, hidden);
      expect(sample).toEqual({ ok: true, values: ['info'] });
      expect(asked).toHaveLength(1);
      expect(asked[0]).toStartWith(`${pattern},`);
      expect(asked[0]?.split(',')).toContain('-logs-secret');
    }
    expect((await searchSample('logs-a*', hidden)).asked).toEqual(['logs-a*']);
  });

  test('refuses a pattern that reaches only hidden indices', async () => {
    const cases: [string, Partial<ObjectVisibility>][] = [
      ['logs-secre*', hidden],
      ['secu*', {}],
      ['secu*', { mode: 'only', names: ['secu*'] }],
    ];
    for (const [pattern, visibility] of cases) {
      const { sample, asked } = await searchSample(pattern, visibility);
      expect(sample).toEqual({
        ok: false,
        error:
          'The index pattern reaches nothing this connector shows. Name an index its schema lists, or its pattern.',
      });
      expect(asked).toEqual([]);
    }
  });

  test('refuses a hidden index in a list, and an alias onto one', async () => {
    const listed = await searchSample('logs-app,logs-secret', hidden);
    expect(listed.sample).toMatchObject({ ok: false });
    expect(listed.asked).toEqual([]);
    const alias = await searchSample('all-logs', hidden);
    expect(alias.sample).toMatchObject({ ok: false });
    expect(alias.asked).toEqual([]);
  });

  test('refuses a pattern when the kind cannot resolve it', async () => {
    const { sample, asked } = await searchSample('logs-*', hidden, false);
    expect(sample).toMatchObject({ ok: false });
    expect(asked).toEqual([]);
    expect((await searchSample('logs-app', hidden, false)).asked).toEqual(['logs-app']);
    expect((await searchSample('logs-app,logs-secret', hidden, false)).asked).toEqual([]);
  });

  test('asks the source nothing more when the connector shows everything', async () => {
    const { asked } = await searchSample('*', { showSystem: true }, false);
    expect(asked).toEqual(['*']);
  });
});
