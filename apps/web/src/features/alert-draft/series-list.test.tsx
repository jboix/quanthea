import { expect, test } from 'bun:test';
import { alertSpecSchema } from '@quanthea/shared';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TrackedSeries } from './replay-model.ts';
import { SeriesList } from './series-list.tsx';

const spec = alertSpecSchema.parse({
  specVersion: 1,
  title: 'Checkout 5xx',
  query: { refId: 'A', connector: 'prometheus', language: 'promql', expr: 'up' },
  value: { by: ['service'] },
  condition: { kind: 'threshold', op: 'above', value: 0.05, for: '5m' },
  every: '1m',
  lookback: '10m',
  severity: 'critical',
  message: { title: '{alert}', body: '{value}' },
});

/**
 * Series of a replay, the first of which fired twice.
 *
 * @param count - How many.
 * @returns The series.
 */
function seriesOf(count: number): TrackedSeries[] {
  return Array.from({ length: count }, (_, index) => {
    const service = `svc-${String(index + 1).padStart(2, '0')}`;
    const track = {
      points: [],
      firing: [],
      tooShort: [],
      firings: index === 0 ? 2 : 0,
      firingMs: 0,
    };
    return { key: service, labels: { service }, track };
  });
}

test('lists ten series at a time, with a pager for the rest', () => {
  const html = renderToStaticMarkup(<SeriesList spec={spec} series={seriesOf(14)} />);
  expect(html).toContain('One alert per service');
  expect(html.split('<li').length - 1).toBe(10);
  expect(html).toContain('fired 2×');
  expect(html).not.toContain('svc-11');
  expect(html).toContain('1–10 of 14');
  expect(html).toContain('Next');
});

test('says so when the replay found no series', () => {
  const html = renderToStaticMarkup(<SeriesList spec={spec} series={[]} />);
  expect(html).toContain('The replay found no series.');
  expect(html).not.toContain('<nav');
});
