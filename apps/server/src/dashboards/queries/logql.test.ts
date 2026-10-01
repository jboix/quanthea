import { describe, expect, test } from 'bun:test';
import { queryText } from '@querent/shared';
import { bindTemplate } from '../../query/bind.ts';
import { buildData } from './build.ts';
import { dataSchema } from './request.ts';

const timeRange = { from: new Date('2026-09-27T12:00:00Z'), to: new Date('2026-09-27T13:00:00Z') };

/** The checkout streams. */
const checkout = [{ field: 'service', value: '$service' }];

/**
 * Builds a LogQL request on the `loki` connector and returns its text.
 *
 * @param data - The request, without its connector.
 * @returns The query text and the output.
 */
function built(data: Record<string, unknown>) {
  const result = buildData(dataSchema.parse({ connector: 'loki', ...data }));
  const [query] = result.queries;
  if (!query) throw new Error('Nothing was built.');
  return { text: queryText(query), query, output: result.output };
}

describe('the LogQL builders', () => {
  test('count lines over time, with line filters, a parser and field filters', () => {
    const { text, output } = built({
      kind: 'logql-series',
      stream: checkout,
      contains: ['timeout', '$text'],
      parser: 'json',
      filters: [{ field: 'status', op: '=~', value: '5..' }],
      by: ['route'],
    });
    expect(text).toBe(
      'sum by (route) (count_over_time({service="$service"} |= "timeout" |= "$text" | json | status=~"5.." [$__interval]))',
    );
    expect(output).toMatchObject({ shape: 'long', columns: ['time', 'route', 'series', 'value'] });
  });

  test('read numbers with unwrap, grouped in the range function, errors dropped', () => {
    const { text } = built({
      kind: 'logql-series',
      stream: checkout,
      parser: 'logfmt',
      measure: { fn: 'quantile', field: 'duration_ms', quantile: 0.5 },
    });
    expect(text).toBe(
      'quantile_over_time(0.5, {service="$service"} | logfmt | unwrap duration_ms | __error__="" [$__interval]) by ()',
    );
    expect(() => built({ kind: 'logql-stat', stream: checkout, measure: { fn: 'avg' } })).toThrow(
      'avg needs a field',
    );
  });

  test('divide matching lines by all lines, over time or over the range', () => {
    const overTime = built({
      kind: 'logql-ratio',
      stream: checkout,
      match: [{ field: 'level', value: 'error' }],
      complement: true,
    });
    expect(overTime.text).toBe(
      '1 - (sum (count_over_time({service="$service"} | level="error" [$__interval])) / sum (count_over_time({service="$service"} [$__interval])))',
    );
    const perService = built({
      kind: 'logql-ratio',
      stream: [{ field: 'env', value: 'prod' }],
      match: [{ field: 'level', value: 'error' }],
      by: ['service'],
      over: 'range',
    });
    expect(perService.text).toContain('[$__range]');
    expect(perService.query).toMatchObject({ instant: true });
    expect(perService.output).toMatchObject({ columns: ['service', 'Value'], unit: 'percent' });
  });

  test('pass the LogQL binder', () => {
    const variables = { service: { value: ['checkout-svc', 'cart-svc'] }, text: { value: 'x"y' } };
    for (const data of [
      { kind: 'logql-series', contains: ['$text'], measure: { fn: 'rate' } },
      { kind: 'logql-ratio', match: [{ field: 'level', value: 'error' }], over: 'range' },
      {
        kind: 'logql-breakdown',
        by: ['level'],
        parser: 'json',
        measure: { fn: 'avg', field: 'ms' },
      },
      { kind: 'logql-stat' },
      { kind: 'logql-lines', parser: 'json', filters: [{ field: 'level', value: 'error' }] },
    ]) {
      const { query } = built({
        stream: [{ field: 'service', op: '=~', value: '$service' }],
        ...data,
      });
      expect(() => bindTemplate(query, variables, timeRange)).not.toThrow();
    }
  });
});
