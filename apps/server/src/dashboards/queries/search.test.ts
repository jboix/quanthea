import { describe, expect, test } from 'bun:test';
import type { PanelQuery } from '@quanthea/shared';
import { searchRatioScripts } from '../../connectors/_shared/index.ts';
import { bindTemplate } from '../../query/bind.ts';
import { checkBinding } from '../check-queries.ts';
import { buildData } from './build.ts';
import { dataSchema } from './request.ts';

const timeRange = { from: new Date('2026-09-27T12:00:00Z'), to: new Date('2026-09-27T13:00:00Z') };

/**
 * Builds a search request on the `events` connector over `events-*`.
 *
 * @param data - The request, without its connector and index.
 * @returns The query and its output.
 */
function built(data: Record<string, unknown>) {
  return buildData(dataSchema.parse({ connector: 'events', index: 'events-*', ...data }));
}

/**
 * The body of a built search.
 *
 * @param query - The query.
 * @returns The body.
 */
function bodyOf(query: PanelQuery | undefined): Record<string, unknown> {
  if (query?.language !== 'search') throw new Error('Not a search.');
  return query.body;
}

const range = { range: { '@timestamp': { gte: { $var: '__from' }, lte: { $var: '__to' } } } };

describe('the search builders', () => {
  test('filter with terms for variables, term for literals, regexp for patterns', () => {
    const { queries } = built({
      kind: 'search-stat',
      filters: [
        { field: 'event_name', value: 'START' },
        { field: 'session.player.platform', value: '$platform' },
        { field: 'session.media.id', op: '=~', value: 'urn:srf:.*' },
        { field: 'data.error_type', op: '!=', value: 'DRM_NOT_SUPPORTED' },
      ],
    });
    expect(bodyOf(queries[0])).toEqual({
      size: 0,
      query: {
        bool: {
          filter: [
            range,
            { term: { event_name: 'START' } },
            { terms: { 'session.player.platform': { $var: 'platform', as: 'list' } } },
            { regexp: { 'session.media.id': 'urn:srf:.*' } },
          ],
          must_not: [{ term: { 'data.error_type': 'DRM_NOT_SUPPORTED' } }],
        },
      },
      aggs: { value: { value_count: { field: '@timestamp' } } },
    });
  });

  test('write a ratio with the kit script, over time and per value over the range', () => {
    const overTime = built({
      kind: 'search-ratio',
      match: [{ field: 'event_name', value: 'ERROR' }],
      of: [{ field: 'event_name', value: 'START' }],
      complement: true,
      interval: '$interval',
    });
    expect(bodyOf(overTime.queries[0]).aggs).toEqual({
      time: {
        date_histogram: {
          field: '@timestamp',
          fixed_interval: { $var: 'interval' },
          min_doc_count: 0,
        },
        aggs: {
          _matching: { filter: { bool: { filter: [{ term: { event_name: 'ERROR' } }] } } },
          _total: { filter: { bool: { filter: [{ term: { event_name: 'START' } }] } } },
          value: {
            bucket_script: {
              buckets_path: { part: '_matching>_count', whole: '_total>_count' },
              script: searchRatioScripts.complement,
            },
          },
        },
      },
    });
    expect(overTime.output).toMatchObject({ columns: ['time', 'value'], unit: 'percent' });
    const perMedia = built({
      kind: 'search-ratio',
      match: [{ field: 'event_name', value: 'ERROR' }],
      over: 'range',
      by: 'session.media.id',
      counts: true,
    });
    expect(perMedia.output.columns).toEqual(['session.media.id', 'matching', 'total', 'value']);
    const aggs = bodyOf(perMedia.queries[0]).aggs as Record<string, { terms: unknown }>;
    expect(aggs['session.media.id']?.terms).toEqual({
      field: 'session.media.id',
      size: 10,
      order: { matching: 'desc' },
    });
    const whole = built({
      kind: 'search-ratio',
      match: [{ field: 'x', value: 'y' }],
      over: 'range',
    });
    expect(Object.keys(bodyOf(whole.queries[0]).aggs as object)).toEqual(['_all']);
    expect(whole.output).toMatchObject({ shape: 'single', columns: ['value'] });
  });

  test('pass the search binder, ratio script included', () => {
    const variables = { platform: { value: 'Web' }, interval: { value: '5m', duration: true } };
    for (const data of [
      { kind: 'search-ratio', match: [{ field: 'level', value: 'error' }], by: 'service' },
      { kind: 'search-series', by: 'level', measure: { fn: 'percentiles', field: 'ms' } },
      { kind: 'search-breakdown', by: 'service', series: 'level' },
      { kind: 'search-histogram', field: 'ms', width: 100 },
      { kind: 'search-rows', fields: ['@timestamp', 'message'] },
    ]) {
      const [query] = built({ ...data, filters: [{ field: 'p', value: '$platform' }] }).queries;
      if (!query) throw new Error('Nothing was built.');
      expect(() => bindTemplate(query, variables, timeRange)).not.toThrow();
    }
  });

  test('filter by a list, a bound, a wildcard, a field that has a value and one of several', () => {
    const total = 'session.qoe_timings.total';
    const { queries } = built({
      kind: 'search-stat',
      filters: [
        { field: 'event_name', value: 'START' },
        { field: 'session.player.platform', op: 'in', values: ['Web', 'Apple'] },
        { field: total, op: '>', value: '3000' },
        { field: 'session.media.id', op: 'like', value: 'urn:srf:*', any: 'media' },
        { field: 'session.media.id', op: 'exists', any: 'media' },
      ],
    });
    expect(bodyOf(queries[0]).query).toEqual({
      bool: {
        filter: [
          range,
          { term: { event_name: 'START' } },
          { terms: { 'session.player.platform': ['Web', 'Apple'] } },
          { range: { [total]: { gt: '3000' } } },
          {
            bool: {
              should: [
                { wildcard: { 'session.media.id': { value: 'urn:srf:*' } } },
                { exists: { field: 'session.media.id' } },
              ],
              minimum_should_match: 1,
            },
          },
        ],
      },
    });
    const ratio = built({
      kind: 'search-ratio',
      match: [{ field: total, op: '>=', value: '$slow' }],
      of: [{ field: 'session.player.platform', op: 'in', values: ['$platform'] }],
    });
    const aggs = bodyOf(ratio.queries[0]).aggs as { time: { aggs: Record<string, unknown> } };
    expect(aggs.time.aggs._matching).toEqual({
      filter: { bool: { filter: [{ range: { [total]: { gte: { $var: 'slow', as: 'one' } } } }] } },
    });
    expect(aggs.time.aggs._total).toEqual({
      filter: {
        bool: {
          filter: [{ terms: { 'session.player.platform': { $var: 'platform', as: 'list' } } }],
        },
      },
    });
  });

  test('refuse a filter its operator cannot read, with what to write', () => {
    const stat = (filter: Record<string, unknown>) =>
      built({ kind: 'search-stat', filters: [filter] });
    expect(() => stat({ field: 'event_name', op: 'in', value: 'START' })).toThrow(
      'The filter on event_name with "in" takes a list in "values", not "value".',
    );
    expect(() => stat({ field: 'event_name', op: '=~', values: ['$names'] })).toThrow(
      'The filter on event_name with "=~" needs "value".',
    );
    expect(() => stat({ field: 'session.media.id', op: 'like', value: '*srf*' })).toThrow(
      'starts with a wildcard, which reads every value of the field',
    );
    expect(() => stat({ field: 'event_name', value: 'START', any: 'a' })).toThrow(
      'One filter alone has "any": "a".',
    );
    expect(() => built({ kind: 'search-ratio', match: [{ field: 'x', op: 'in' }] })).toThrow(
      'The filter on x with "in" needs "values".',
    );
  });

  test('report a multi-value variable where one value fits when the dashboard is checked', () => {
    const guardrails = { timeoutMs: 10_000, maxRows: 50_000, maxRangeDays: 90 };
    const connector = { language: 'search' as const, guardrails };
    const several = { names: { value: ['START', 'STOP'] } };
    const issuesOf = (filter: Record<string, unknown>) => {
      const [query] = built({ kind: 'search-stat', filters: [filter] }).queries;
      if (!query) throw new Error('Nothing was built.');
      const located = { query, path: 'panels[0].queries[0]' };
      return checkBinding(located, connector, several, { from: 0, to: 3_600_000 });
    };
    for (const op of ['=~', '!~', '>', '>=', '<', '<=', 'like']) {
      expect(issuesOf({ field: 'event_name', op, value: '$names' })).toEqual([
        {
          path: 'panels[0].queries[0].body',
          message:
            'names can hold several values, and a pattern or a bound takes one: use a variable of one value there, or filter by a list with "in".',
        },
      ]);
    }
    expect(issuesOf({ field: 'event_name', op: 'in', values: ['$names'] })).toEqual([]);
    expect(issuesOf({ field: 'event_name', op: '!=', value: '$names' })).toEqual([]);
  });

  test('order breakdowns by a metric, else by count, and name percentile columns', () => {
    const avg = built({
      kind: 'search-breakdown',
      by: 'service',
      measure: { fn: 'avg', field: 'ms' },
    });
    const terms = (bodyOf(avg.queries[0]).aggs as Record<string, { terms: unknown }>).service;
    expect(terms?.terms).toEqual({ field: 'service', size: 10, order: { value: 'desc' } });
    const p = built({
      kind: 'search-series',
      measure: { fn: 'percentiles', field: 'ms', percents: [50, 95] },
    });
    expect(p.output.columns).toEqual(['time', 'value p50', 'value p95']);
    expect(() => built({ kind: 'search-stat', measure: { fn: 'avg' } })).toThrow(
      'avg needs a field',
    );
  });
});
