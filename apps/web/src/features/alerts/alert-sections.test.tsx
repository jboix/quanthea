import { expect, test } from 'bun:test';
import type { AlertDetail } from '@quanthea/shared';
import { renderToStaticMarkup } from 'react-dom/server';
import { SeriesNow } from './alert-sections.tsx';
import { detailedAlert } from './test-alerts.ts';

/**
 * Series named `svc-01` onwards, all OK but the last, which fires.
 *
 * @param count - How many.
 * @returns The series.
 */
function seriesOf(count: number): AlertDetail['series'] {
  return Array.from({ length: count }, (_, index) => {
    const service = `svc-${String(index + 1).padStart(2, '0')}`;
    const state = index === count - 1 ? ('firing' as const) : ('ok' as const);
    return {
      key: service,
      labels: { service },
      state,
      since: 0,
      value: index,
      evaluatedAt: 0,
      notifiedAt: null,
    };
  });
}

/**
 * The series card as markup.
 *
 * @param count - How many series the alert has.
 * @returns The markup.
 */
function card(count: number): string {
  return renderToStaticMarkup(
    <SeriesNow alert={detailedAlert({ series: seriesOf(count) })} now={60_000} />,
  );
}

test('shows ten series at a time, the worst first, and says how many there are', () => {
  const html = card(23);
  expect(html.split('<li').length - 1).toBe(10);
  expect(html.indexOf('svc-23')).toBeLessThan(html.indexOf('svc-01'));
  expect(html).not.toContain('svc-10');
  expect(html).toContain('1–10 of 23');
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Previous/);
  expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Next/);
});

test('has no controls for a list of one page, and no pager before the first evaluation', () => {
  const few = card(4);
  expect(few).toContain('1–4 of 4');
  expect(few).not.toContain('<button');
  expect(card(0)).toContain('Not evaluated yet.');
  expect(card(0)).not.toContain('<nav');
});
