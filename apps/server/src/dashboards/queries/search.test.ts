import { describe, expect, test } from 'bun:test';
import type { PanelQuery } from '@quanthea/shared';
import { searchRatioScripts } from '../../connectors/_shared/index.ts';
import { bindTemplate } from '../../query/bind.ts';
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
          min_doc_count: 1,
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
