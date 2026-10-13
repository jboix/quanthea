import { describe, expect, test } from 'bun:test';
import { bindTemplate } from '../../query/bind.ts';
import { boolQuery, searchFiltersSchema } from './search-filters.ts';

const timeRange = { from: new Date('2026-09-27T12:00:00Z'), to: new Date('2026-09-27T13:00:00Z') };

/**
 * The bool query of filters in the flat form, read through their schema.
 *
 * @param filters - The filters, as a request writes them.
 * @returns The query.
 */
function queryOf(filters: readonly Record<string, unknown>[]): Record<string, unknown> {
  return boolQuery(searchFiltersSchema.parse(filters));
}

/**
 * The clauses that must hold for one filter.
 *
 * @param filter - The filter, as a request writes it.
 * @returns The `filter` list of the bool query.
 */
function clausesOf(filter: Record<string, unknown>): unknown {
  return (queryOf([filter]).bool as { filter: unknown }).filter;
}

describe('the filters of a search', () => {
  test('write a list as terms, of literals or of one variable', () => {
    expect(clausesOf({ field: 'event_name', op: 'in', values: ['START', 'STOP'] })).toEqual([
      { terms: { event_name: ['START', 'STOP'] } },
    ]);
    expect(
      clausesOf({ field: 'session.player.platform', op: 'in', values: ['$platform'] }),
    ).toEqual([{ terms: { 'session.player.platform': { $var: 'platform', as: 'list' } } }]);
    expect(() => queryOf([{ field: 'p', op: 'in', values: ['Web', '$platform'] }])).toThrow(
      'The filter on p mixes a variable with other values in "values"',
    );
  });

  test('write each bound as a range whose value is a JSON string or a variable node', () => {
    const field = 'session.qoe_timings.total';
    const bounds = { '>': 'gt', '>=': 'gte', '<': 'lt', '<=': 'lte' };
    for (const [op, key] of Object.entries(bounds)) {
      expect(clausesOf({ field, op, value: '3000' })).toEqual([
        { range: { [field]: { [key]: '3000' } } },
      ]);
    }
    expect(clausesOf({ field, op: '>=', value: '$slow' })).toEqual([
      { range: { [field]: { gte: { $var: 'slow', as: 'one' } } } },
    ]);
  });

  test('write exists and a wildcard', () => {
    expect(clausesOf({ field: 'data.error_type', op: 'exists' })).toEqual([
      { exists: { field: 'data.error_type' } },
    ]);
    expect(clausesOf({ field: 'session.media.id', op: 'like', value: 'urn:srf:*' })).toEqual([
      { wildcard: { 'session.media.id': { value: 'urn:srf:*' } } },
    ]);
    expect(clausesOf({ field: 'session.media.id', op: 'like', value: '$media' })).toEqual([
      { wildcard: { 'session.media.id': { value: { $var: 'media', as: 'one' } } } },
    ]);
  });

  test('write any as alternatives of which one must hold, a negated one inside its own bool', () => {
    const any = [
      { field: 'session.player.platform', value: 'Web' },
      { field: 'session.qoe_timings.total', op: '>', value: '5000' },
      { field: 'event_name', op: '!=', value: 'HEARTBEAT' },
    ];
    expect(queryOf([{ field: 'event_name', op: '!~', value: 'ST.*' }, { any }])).toEqual({
      bool: {
        filter: [
          {
            bool: {
              should: [
                { term: { 'session.player.platform': 'Web' } },
                { range: { 'session.qoe_timings.total': { gt: '5000' } } },
                { bool: { must_not: [{ term: { event_name: 'HEARTBEAT' } }] } },
              ],
              minimum_should_match: 1,
            },
          },
        ],
        must_not: [{ regexp: { event_name: 'ST.*' } }],
      },
    });
  });

  test('refuse a filter missing what its operator needs, naming it', () => {
    const field = 'event_name';
    const refused: [Record<string, unknown>, string][] = [
      [{ op: 'exists' }, 'A filter with "exists" needs "field".'],
      [{ field, op: 'in' }, 'The filter on event_name with "in" needs "values".'],
      [{ field, op: '>=' }, 'The filter on event_name with ">=" needs "value".'],
      [{ field }, 'The filter on event_name with "=" needs "value".'],
      [
        { field, op: '=~', values: ['START', 'STOP'] },
        'The filter on event_name with "=~" needs "value".',
      ],
      [
        { field, op: '=~', value: 'S.*', values: ['$names'] },
        'The filter on event_name with "=~" takes one "value" ("in" takes a list), not "values".',
      ],
      [
        { field, op: 'in', value: 'START', values: ['STOP'] },
        'The filter on event_name with "in" takes a list in "values", not "value".',
      ],
      [
        { field, op: 'exists', value: 'true' },
        'The filter on event_name with "exists" takes no value, not "value".',
      ],
    ];
    for (const [filter, message] of refused) expect(() => queryOf([filter])).toThrow(message);
  });

  test('refuse any beside a field of its own, any inside any, and more than twenty filters', () => {
    const leaf = { field: 'event_name', value: 'START' };
    expect(() => queryOf([{ field: 'event_name', any: [leaf, leaf] }])).toThrow(
      'A filter with "any" takes nothing else',
    );
    expect(() => queryOf([{ op: '!=', any: [leaf, leaf] }])).toThrow(
      'A filter with "any" takes nothing else',
    );
    expect(searchFiltersSchema.safeParse([{ any: [leaf, { any: [leaf, leaf] }] }]).success).toBe(
      false,
    );
    expect(searchFiltersSchema.safeParse([{ any: [leaf] }]).success).toBe(false);
    const any = Array.from({ length: 10 }, () => leaf);
    expect(() => queryOf([{ any }, { any }])).not.toThrow();
    expect(() => queryOf([{ any }, { any }, leaf])).toThrow(
      'A search takes 20 filters at most, counting those in "any".',
    );
  });

  test('pass the search binder with a multi-value variable in a list', () => {
    const query = queryOf([
      { field: 'session.player.platform', op: 'in', values: ['$platform'] },
      { field: 'session.qoe_timings.total', op: '<', value: '$slow' },
      { field: 'session.media.id', op: 'like', value: 'urn:*' },
      { field: 'data.error_type', op: 'exists' },
    ]);
    const template = {
      refId: 'A',
      connector: 'events',
      language: 'search' as const,
      index: 'core_events',
      body: { size: 0, query },
    };
    const variables = { platform: { value: ['Web', 'Apple'] }, slow: { value: '3000' } };
    const bound = bindTemplate(template, variables, timeRange);
    if (bound.language !== 'search') throw new Error('Not a search.');
    expect(bound.body.query).toEqual({
      bool: {
        filter: [
          { terms: { 'session.player.platform': ['Web', 'Apple'] } },
          { range: { 'session.qoe_timings.total': { lt: '3000' } } },
          { wildcard: { 'session.media.id': { value: 'urn:*' } } },
          { exists: { field: 'data.error_type' } },
        ],
      },
    });
  });

  test('refuse a multi-value variable in a pattern or a bound when the query is bound', () => {
    const boundWith = (filter: Record<string, unknown>, value: string | string[]) => {
      const body = { size: 0, query: queryOf([filter]) };
      const template = { refId: 'A', connector: 'events', language: 'search' as const };
      return bindTemplate({ ...template, index: 'core_events', body }, { p: { value } }, timeRange);
    };
    const refusal =
      'p can hold several values, and a pattern or a bound takes one: use a variable of one value there, or filter by a list with "in".';
    for (const op of ['=~', '!~', '>', '>=', '<', '<=', 'like']) {
      const filter = { field: 'event_name', op, value: '$p' };
      expect(() => boundWith(filter, ['START', 'STOP'])).toThrow(refusal);
      expect(() => boundWith(filter, ['START'])).toThrow(refusal);
      expect(() => boundWith(filter, 'START')).not.toThrow();
    }
    const one = boundWith({ field: 'event_name', op: '=~', value: '$p' }, 'ST.*');
    expect(one.language === 'search' && one.body.query).toEqual({
      bool: { filter: [{ regexp: { event_name: 'ST.*' } }] },
    });
    expect(() => boundWith({ field: 'event_name', value: '$p' }, ['START', 'STOP'])).not.toThrow();
  });

  test('refuse any with fewer than two filters, however it is called', () => {
    expect(() => boolQuery([{ op: '=', any: [] }])).toThrow('"any" takes two filters or more.');
    expect(() => boolQuery([{ op: '=', any: [{ field: 'a', op: 'exists' }] }])).toThrow(
      '"any" takes two filters or more.',
    );
  });
});
