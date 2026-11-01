import { describe, expect, test } from 'bun:test';
import type { PanelQuery } from '@quanthea/shared';
import { searchRatioScripts } from '../../connectors/_shared/index.ts';
import { bindTemplate } from '../../query/bind.ts';
import { buildData } from './build.ts';
import { dataSchema } from './request.ts';

const timeRange = { from: new Date('2026-09-27T12:00:00Z'), to: new Date('2026-09-27T13:00:00Z') };

/**
 * Builds a search table on the `events` connector over `events-*`.
 *
 * @param data - The table's fields, without its kind, connector and index.
 * @returns The query and its output.
 */
function built(data: Record<string, unknown>) {
  const request = { kind: 'search-table', connector: 'events', index: 'events-*', ...data };
  return buildData(dataSchema.parse(request));
}

/**
 * The aggregations of a built search.
 *
 * @param query - The query.
 * @returns Its `aggs`.
 */
function aggsOf(query: PanelQuery | undefined): Record<string, unknown> {
  if (query?.language !== 'search') throw new Error('Not a search.');
  return query.body.aggs as Record<string, unknown>;
}

const errors = [{ field: 'event_name', value: 'ERROR' }];
const starts = [{ field: 'event_name', value: 'START' }];

describe('the search table builder', () => {
  test('groups by one field with terms, each column under its own filters', () => {
    const { queries, output } = built({
      by: ['browser'],
      columns: [
        { name: 'events' },
        { name: 'errors', filters: errors },
        { name: 'slow', fn: 'percentile', field: 'load_ms', percent: 95, filters: starts },
        { name: 'sessions', fn: 'cardinality', field: 'session.id' },
      ],
      limit: 200,
    });
    expect(aggsOf(queries[0])).toEqual({
      browser: {
        terms: { field: 'browser', size: 200, order: { events: 'desc' } },
        aggs: {
          events: { value_count: { field: '@timestamp' } },
          errors: { filter: { bool: { filter: [{ term: { event_name: 'ERROR' } }] } } },
          slow_filter: {
            filter: { bool: { filter: [{ term: { event_name: 'START' } }] } },
            aggs: { slow: { percentiles: { field: 'load_ms', percents: [95] } } },
          },
          sessions: { cardinality: { field: 'session.id' } },
        },
      },
    });
    expect(output).toEqual({
      shape: 'long',
      columns: ['browser', 'events', 'errors', 'slow p95', 'sessions'],
      chart: 'table.rows',
    });
  });

  test('groups by several fields with multi_terms, a column per field', () => {
    const { queries, output } = built({
      by: ['browser', 'browser_version'],
      columns: [{ name: 'errors', filters: errors }],
    });
    expect(aggsOf(queries[0])).toMatchObject({
      groups: {
        multi_terms: {
          terms: [{ field: 'browser' }, { field: 'browser_version' }],
          size: 10,
          order: { 'errors>_count': 'desc' },
        },
      },
    });
    expect(output.columns).toEqual(['browser', 'browser_version', 'errors']);
  });

  test('computes a ratio of two columns with the kit script, and sorts it over the groups kept', () => {
    const { queries } = built({
      by: ['browser'],
      columns: [
        { name: 'starts', filters: starts },
        { name: 'failed', filters: errors },
        { name: 'failure_rate', fn: 'ratio', part: 'failed', whole: 'starts' },
        { name: 'success', fn: 'ratio', part: 'failed', whole: 'starts', complement: true },
        { name: 'share', fn: 'ratio', part: 'failed' },
      ],
      sort: 'failure_rate',
      ascending: true,
    });
    const group = aggsOf(queries[0]).browser as Record<string, Record<string, unknown>>;
    expect(group.terms).toMatchObject({ order: { _count: 'desc' } });
    expect(group.aggs).toMatchObject({
      failure_rate: {
        bucket_script: {
          buckets_path: { part: 'failed>_count', whole: 'starts>_count' },
          script: searchRatioScripts.ratio,
        },
      },
      success: { bucket_script: { script: searchRatioScripts.complement } },
      share: { bucket_script: { buckets_path: { part: 'failed>_count', whole: '_count' } } },
      _sort: { bucket_sort: { sort: [{ failure_rate: { order: 'asc' } }] } },
    });
  });

  test('sorts by a metric through the grouping, a filtered metric by its path', () => {
    const order = (columns: unknown[], sort: string) => {
      const group = aggsOf(built({ by: ['a'], columns, sort }).queries[0]).a as {
        terms: { order: unknown };
      };
      return group.terms.order;
    };
    const average = { name: 'load', fn: 'avg', field: 'load_ms', filters: starts };
    expect(order([average], 'load')).toEqual({ 'load_filter>load': 'desc' });
    expect(order([{ name: 'p', fn: 'percentile', field: 'x', percent: 95 }], 'p')).toEqual({
      'p.95': 'desc',
    });
  });

  test('asks for an "Other" row in its plain count columns, and refuses one without them', () => {
    const [query] = built({
      by: ['browser'],
      columns: [{ name: 'events' }, { name: 'errors', filters: errors }],
      other: true,
    }).queries;
    expect(aggsOf(query)).toMatchObject({ browser: { meta: { other: ['events'] } } });
    const filteredOnly = { by: ['browser'], columns: [{ name: 'errors', filters: errors }] };
    expect(() => built({ ...filteredOnly, other: true })).toThrow(
      '"other" needs a count column with no filters, which it fills.',
    );
  });

  test('groups by named sets of filters, sorted with a bucket sort', () => {
    const { queries, output } = built({
      groups: [
        { name: 'Coast', filters: [{ field: 'bu', op: 'in', values: ['north', 'west'] }] },
        { name: 'Inland', filters: [{ field: 'bu', op: 'in', values: ['south', 'east'] }] },
      ],
      columns: [{ name: 'starts', filters: starts }],
    });
    expect(aggsOf(queries[0])).toEqual({
      group: {
        filters: {
          filters: {
            Coast: { bool: { filter: [{ terms: { bu: ['north', 'west'] } }] } },
            Inland: { bool: { filter: [{ terms: { bu: ['south', 'east'] } }] } },
          },
        },
        aggs: {
          starts: { filter: { bool: { filter: [{ term: { event_name: 'START' } }] } } },
          _sort: { bucket_sort: { sort: [{ 'starts>_count': { order: 'desc' } }] } },
        },
      },
    });
    expect(output.columns).toEqual(['group', 'starts']);
  });

  test('takes "by" or "groups", not both, and no "Other" row with groups', () => {
    const groups = [
      { name: 'a', filters: starts },
      { name: 'b', filters: errors },
    ];
    const columns = [{ name: 'n' }];
    expect(() => built({ columns })).toThrow('Split by "by" or by named "groups"');
    expect(() => built({ by: ['x'], groups, columns })).toThrow('one of the two');
    expect(() => built({ groups, columns, other: true })).toThrow('"other" goes with "by"');
    const twice = [groups[0], { ...groups[1], name: 'a' }];
    expect(() => built({ groups: twice, columns })).toThrow('Two groups are named "a".');
  });

  test('binds the time range and variables like any search', () => {
    const [query] = built({
      by: ['browser'],
      columns: [{ name: 'errors', filters: [{ field: 'platform', value: '$platform' }] }],
    }).queries;
    if (!query) throw new Error('Nothing was built.');
    expect(() => bindTemplate(query, { platform: { value: 'web' } }, timeRange)).not.toThrow();
  });

  test('refuses names that clash or do not fit, and a ratio of what it cannot read', () => {
    const refusal = (columns: unknown[], extra: Record<string, unknown> = {}) => {
      try {
        built({ by: ['browser'], columns, ...extra });
        return '';
      } catch (error) {
        return (error as Error).message;
      }
    };
    expect(refusal([{ name: 'a' }, { name: 'a' }])).toBe('Two columns are named "a".');
    expect(refusal([{ name: 'browser' }])).toBe('Two columns are named "browser".');
    expect(refusal([{ name: '_hidden' }])).toContain('cannot name a column');
    expect(refusal([{ name: 'wrapper' }])).toContain('cannot name a column');
    expect(refusal([{ name: 'a' }, { name: 'r', fn: 'ratio', part: 'nope' }])).toContain(
      '"part" and "whole" name count or metric columns',
    );
    const percentile = { name: 'p', fn: 'percentile', field: 'x', percent: 95 };
    expect(refusal([percentile, { name: 'r', fn: 'ratio', part: 'p' }])).toContain('"part"');
    expect(refusal([{ name: 'p', fn: 'percentile', field: 'x' }])).toBe('p needs a percent.');
    expect(refusal([{ name: 'a' }], { sort: 'b' })).toBe('"sort" names no column: b.');
    expect(refusal([{ name: 's', fn: 'sum' }])).toBe('sum needs a field.');
  });
});
