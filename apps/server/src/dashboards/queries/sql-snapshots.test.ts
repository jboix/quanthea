/**
 * The SQL every builder writes, in every dialect, and the statement each binds to: a snapshot
 * committed beside this file (`__snapshots__/`). A change to a builder shows here, line by line, in
 * review. Update with `bun test -u` only when the change is meant.
 */
import { describe, expect, test } from 'bun:test';
import { type PanelQuery, queryText, savedQuerySchema } from '@querent/shared';
import { bindTemplate } from '../../query/bind.ts';
import type { SqlDialect } from '../../query/sql-dialects.ts';
import type { Variables } from '../../query/variables.ts';
import { buildData } from './build.ts';
import { dataSchema } from './request.ts';
import { markersQuery } from './sql.ts';

const dialects: readonly SqlDialect[] = ['postgres', 'mysql', 'clickhouse', 'trino', 'influxdb'];

const timeRange = { from: new Date('2026-09-27T12:00:00Z'), to: new Date('2026-09-27T13:00:00Z') };

/** The variables every case binds with: one value, several values, an interval. */
const variables: Variables = {
  service: { value: ['checkout-svc', 'cart-svc'] },
  status: { value: 'failed' },
  pattern: { value: '^payment' },
  interval: { value: '5m', duration: true },
};

/** A saved SQL query with every kind of placeholder. */
const failedBy = savedQuerySchema.parse({
  id: 'failed-by',
  name: 'Failed by column',
  description: 'Failed rows by a column.',
  language: 'sql',
  query:
    'SELECT {{column}} AS name, count(*) AS value FROM {{table}} WHERE status = {{status}} AND created_at > :__from - {{window}} GROUP BY 1',
  params: [
    { name: 'column', kind: 'column' },
    { name: 'table', kind: 'table' },
    { name: 'status', kind: 'value' },
    { name: 'window', kind: 'duration' },
  ],
  shape: 'long',
});

/** Each case: a data request without its connector. */
const cases: Readonly<Record<string, Record<string, unknown>>> = {
  'series: a literal bucket, split, a variable list': {
    kind: 'sql-series',
    table: 'orders',
    time: 'created_at',
    by: 'status',
    bucket: '15m',
    filters: [{ field: 'service', value: '$service' }],
  },
  'series: an interval variable, a sum, a regular expression': {
    kind: 'sql-series',
    table: 'shop.orders',
    time: 'created_at',
    bucket: '$interval',
    measure: { fn: 'sum', column: 'total' },
    filters: [{ field: 'failure_reason', op: '=~', value: '$pattern' }],
  },
  'breakdown: the range, an average, a limit, a negated literal': {
    kind: 'sql-breakdown',
    table: 'orders',
    time: 'created_at',
    by: 'region',
    measure: { fn: 'avg', column: 'total' },
    limit: 7,
    filters: [{ field: 'status', op: '!=', value: 'refunded' }],
  },
  'breakdown: distinct count, no range, a negated pattern': {
    kind: 'sql-breakdown',
    table: 'orders',
    by: 'service',
    measure: { fn: 'count_distinct', column: 'customer_id' },
    filters: [{ field: 'service', op: '!~', value: '^test-' }],
  },
  'stat: the range, an escaped quote, a single-value variable': {
    kind: 'sql-stat',
    table: 'orders',
    time: 'created_at',
    filters: [
      { field: 'note', value: "it's" },
      { field: 'status', value: '$status' },
    ],
  },
  'rows: newest first, a limit': {
    kind: 'sql-rows',
    table: 'deploys',
    time: 'deployed_at',
    columns: ['id', 'service', 'version'],
    limit: 5,
  },
  'rows: no time column': { kind: 'sql-rows', table: 'deploys', columns: ['id'] },
  'ratio: over time, split, an interval variable': {
    kind: 'sql-ratio',
    table: 'orders',
    time: 'created_at',
    by: 'service',
    bucket: '$interval',
    match: [{ field: 'status', value: '$status' }],
  },
  'ratio: over the range, per value, counts, complement, a whole': {
    kind: 'sql-ratio',
    table: 'orders',
    time: 'created_at',
    over: 'range',
    by: 'service',
    counts: true,
    complement: true,
    limit: 3,
    match: [{ field: 'status', value: 'failed' }],
    of: [{ field: 'status', op: '!=', value: 'refunded' }],
  },
  'ratio: over the range, one value': {
    kind: 'sql-ratio',
    table: 'orders',
    over: 'range',
    match: [{ field: 'status', value: 'failed' }],
  },
  'saved: every kind of placeholder': {
    kind: 'saved',
    name: 'failed-by',
    params: { column: 'region', table: 'shop.orders', status: '$status', window: '$interval' },
  },
};

/**
 * The SQL a query holds, and the statement and parameters it binds to.
 *
 * @param query - The built query.
 * @param dialect - The dialect.
 * @returns What the snapshot records.
 */
function written(query: PanelQuery | undefined, dialect: SqlDialect) {
  if (!query) throw new Error('Nothing was built.');
  const bound = bindTemplate(query, variables, timeRange, { dialect });
  return { sql: queryText(query), bound };
}

for (const dialect of dialects) {
  describe(`the SQL builders in ${dialect}`, () => {
    const context = { saved: [failedBy], dialectOf: () => dialect };

    for (const [name, data] of Object.entries(cases))
      test(name, () => {
        const request = dataSchema.parse({ connector: 'shop', ...data });
        expect(written(buildData(request, context).queries[0], dialect)).toMatchSnapshot();
      });

    test('markers: deploys with a filter', () => {
      const query = markersQuery(
        {
          label: 'deploy',
          connector: 'shop',
          table: 'deploys',
          time: 'deployed_at',
          text: 'version',
          filters: [{ field: 'service', op: '=', value: '$service' }],
        },
        context,
      );
      expect(written(query, dialect)).toMatchSnapshot();
    });
  });
}
