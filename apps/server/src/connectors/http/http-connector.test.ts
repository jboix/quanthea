import { describe, expect, test } from 'bun:test';
import { testConnectorConformance } from '@quanthea/plugin-kit/testing';
import { atPointer, cellValue, inferredFields, responseFrame } from './extract.ts';
import { httpConnector } from './http-connector.ts';
import { describeApi } from './openapi.ts';
import { pathRules, pathUnderBase } from './paths.ts';

testConnectorConformance(httpConnector, {
  config: { url: 'https://api.example.com/v1', openapi: '/openapi.json' },
  secret: {},
  query: { language: 'http', method: 'GET', path: '/items', query: [], extract: { rows: '' } },
  invalidQuery: {
    language: 'http',
    method: 'GET',
    path: '/nope',
    query: [],
    extract: { rows: '' },
  },
  sampleField: { entity: 'GET /items', field: 'status' },
  timeRange: { from: new Date(0), to: new Date(1000) },
  live: false,
});

const context = {
  refId: 'A',
  signal: AbortSignal.timeout(1000),
  timeoutMs: 1000,
  maxRows: 100,
  timeRange: { from: new Date(0), to: new Date(1000) },
};

describe('http path rules', () => {
  test('match * within a segment and ** across them, all paths when empty', () => {
    const rules = pathRules('/v1/items/*, /v1/reports/**');
    expect(rules.allows('/v1/items/42')).toBe(true);
    expect(rules.allows('/v1/items/42/secret')).toBe(false);
    expect(rules.allows('/v1/reports/2026/09')).toBe(true);
    expect(rules.allows('/admin')).toBe(false);
    expect(pathRules('').allows('/anything/at/all')).toBe(true);
    expect(pathRules('/a.b').allows('/aXb')).toBe(false);
  });

  test('check the path the request reaches, under the base path, dot segments resolved', () => {
    const base = 'https://api.example.com/api/';
    expect(pathUnderBase(base, '/v1/services/../errors')).toBe('/v1/errors');
    expect(pathUnderBase(base, '/v1/%2e%2e/%2E%2E/internal')).toBeUndefined();
    expect(pathUnderBase(base, '/../admin')).toBeUndefined();
    expect(pathUnderBase(base, '/v1/items')).toBe('/v1/items');
    expect(pathUnderBase('https://api.example.com', '/v1/./items')).toBe('/v1/items');
    expect(pathUnderBase(base, '')).toBe('/');
  });
});

describe('http extraction', () => {
  test('reads JSON pointers, with escaped tokens', () => {
    const document = { data: [{ 'a/b': { '~c': 1 } }] };
    expect(atPointer(document, '/data/0/a~1b/~0c')).toBe(1);
    expect(atPointer(document, '')).toBe(document);
    expect(atPointer(document, '/nope/0')).toBeUndefined();
  });

  test('infers dotted columns and their types from the rows', () => {
    const fields = inferredFields([
      { at: '2026-09-27T12:02:00Z', n: 1, ok: true, meta: { region: 'eu' }, tags: ['a'] },
      { at: '2026-09-27T12:03:00Z', n: 2, ok: false, meta: { region: 'us' }, tags: [] },
    ]);
    expect(fields).toEqual([
      { name: 'at', pointer: '/at', type: 'time' },
      { name: 'n', pointer: '/n', type: 'number' },
      { name: 'ok', pointer: '/ok', type: 'boolean' },
      { name: 'meta.region', pointer: '/meta/region', type: 'string' },
      { name: 'tags', pointer: '/tags', type: 'string' },
    ]);
  });

  test('converts times in seconds or milliseconds, and arrays to JSON', () => {
    expect(cellValue({ name: 't', pointer: '/t', type: 'time', unit: 's' }, 1790510400)).toBe(
      1790510400000,
    );
    expect(cellValue({ name: 't', pointer: '/t', type: 'time' }, 1790510400000)).toBe(
      1790510400000,
    );
    expect(cellValue({ name: 't', pointer: '/t', type: 'string' }, ['a'])).toBe('["a"]');
    expect(cellValue({ name: 't', pointer: '/t', type: 'number' }, 'NaN')).toBeNull();
  });

  test('builds a table from named fields, and refuses rows that are not there', () => {
    const frame = responseFrame(
      { results: [{ s: 'a', v: '2' }] },
      {
        rows: '/results',
        fields: [
          { name: 'service', pointer: '/s' },
          { name: 'value', pointer: '/v', type: 'number' },
        ],
      },
      context,
      5,
    );
    expect(frame.fields).toEqual([
      { name: 'service', type: 'string' },
      { name: 'value', type: 'number' },
    ]);
    expect(frame.values).toEqual([['a'], [2]]);
    expect(() => responseFrame({ a: 1 }, { rows: '/b' }, context, 5)).toThrow('no rows at "/b"');
  });
});

describe('http OpenAPI descriptions', () => {
  const document = {
    paths: {
      '/items/{id}': {
        parameters: [{ $ref: '#/components/parameters/Id' }],
        get: {
          summary: 'One item.',
          parameters: [
            { name: 'expand', in: 'query', schema: { type: 'string', enum: ['owner'] } },
          ],
          responses: {
            '200': {
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Item' } } },
            },
          },
        },
        delete: { summary: 'Never listed.' },
      },
      '/admin/users': { get: { summary: 'Outside the allowed paths.' } },
      '/legacy': {
        get: {
          responses: {
            '200': { schema: { type: 'array', items: { properties: { n: { type: 'integer' } } } } },
          },
        },
      },
    },
    components: {
      parameters: { Id: { name: 'id', in: 'path', required: true, schema: { type: 'string' } } },
      schemas: {
        Item: {
          allOf: [
            { properties: { id: { type: 'string' } } },
            {
              properties: {
                status: { type: 'string', enum: ['open', 'closed'] },
                at: { type: 'string', format: 'date-time' },
              },
            },
          ],
        },
      },
    },
  };
  const operations = describeApi(document, ['get'], pathRules('/items/**, /legacy'));

  test('lists the allowed operations, with references and allOf followed', () => {
    expect([...operations.keys()]).toEqual(['GET /items/{id}', 'GET /legacy']);
    const item = operations.get('GET /items/{id}');
    expect(item?.entity.description).toBe(
      'One item. Parameters: id (path, string, required); expand (query, string).',
    );
    expect(item?.entity.fields.map((field) => [field.name, field.type])).toEqual([
      ['id', 'string'],
      ['status', 'string'],
      ['at', 'time'],
    ]);
    expect(item?.values.get('status')).toEqual(['open', 'closed']);
    expect(item?.values.get('expand')).toEqual(['owner']);
    expect(operations.get('GET /legacy')?.entity.fields).toEqual([
      { name: 'n', nativeType: 'integer', type: 'number' },
    ]);
  });

  test('skips a path key past 2 KB, before any pattern runs over it', () => {
    const long = `/items/${'{'.repeat(50_000)}`;
    const started = performance.now();
    const listed = describeApi({ paths: { [long]: { get: {} } } }, ['get'], pathRules('/items/**'));
    expect(listed.size).toBe(0);
    expect(performance.now() - started).toBeLessThan(100);
    const braces = describeApi(
      { paths: { '/items/{a{b}': { get: {} } } },
      ['get'],
      pathRules('/items/*'),
    );
    expect([...braces.keys()]).toEqual(['GET /items/{a{b}']);
  });

  test('reads at most 5 MiB of a description', async () => {
    const server = Bun.serve({
      port: 0,
      fetch: () => new Response(`{"x":"${'a'.repeat(6 * 1024 * 1024)}"}`),
    });
    try {
      const connection = httpConnector.open({
        config: httpConnector.configSchema.parse({
          url: `http://127.0.0.1:${server.port}`,
          openapi: '/openapi.json',
        }),
        secret: {},
      });
      const failure = await connection.describe(AbortSignal.timeout(5000)).catch((error) => error);
      expect(failure).toMatchObject({ code: 'rejected' });
      expect(failure.safeMessage).toContain('more than 5 MiB');
    } finally {
      server.stop(true);
    }
  });
});
