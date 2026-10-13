import { expect, test } from 'bun:test';
import type { Frame, Mapping, StatView as StatViewSpec } from '@quanthea/shared';
import { renderToStaticMarkup } from 'react-dom/server';
import { StatView } from './stat-view.tsx';

/** Thresholds of a load time: good under 2, a warning up to 4, bad above. */
const steps: Mapping[] = [
  { match: { to: 2 }, tone: 'good' },
  { match: { from: 2, to: 4 }, tone: 'warning' },
  { match: { from: 4 }, tone: 'bad' },
];

/**
 * Renders a stat over one column of one query.
 *
 * @param values - The values of the column, row after row.
 * @param options - What the view adds to a stat of the last value, written as a number.
 * @returns The markup.
 */
function render(values: unknown[], options: Partial<StatViewSpec> = {}): string {
  const frame: Frame = {
    refId: 'A',
    fields: [{ name: 'value', type: typeof values[0] === 'string' ? 'string' : 'number' }],
    values: [values],
    meta: { rowCount: values.length, truncated: false, durationMs: 1 },
  };
  const view = { kind: 'stat', ref: 'A', reduce: 'last', format: { $fmt: 'number' }, ...options };
  const queries = [{ refId: 'A', frames: [frame], error: null }];
  return renderToStaticMarkup(
    <StatView view={view as StatViewSpec} queries={queries} timeZone="UTC" />,
  );
}

test('a stat without mappings shows its number, with no tone', () => {
  const html = render([1.5, 3.25, null]);
  expect(html).toContain('>3.25</span>');
  expect(html).not.toContain('--tone');
  expect(html).not.toContain('data-tone-as');
  expect(render([])).toContain('>–</span>');
  expect(render(['ready'], { field: 'value' })).toContain('>–</span>');
});

test('a stat with thresholds keeps its format and names the design token of its step', () => {
  const html = render([1.5, 3.25, null], { mappings: steps });
  expect(html).toContain('>3.25</span>');
  expect(html).toContain('--tone:var(--color-warning)');
  expect(html).toContain('data-tone-as="text"');
  expect(html).not.toMatch(/#[0-9a-f]{3,6}/i);
  expect(render([9], { mappings: steps })).toContain('--tone:var(--color-danger)');
  expect(render([9], { mappings: steps, reduce: 'sum' })).toContain('--tone:var(--color-danger)');
});

test('a stat can draw its tone as a tint behind the value', () => {
  const html = render([1], { mappings: steps, toneAs: 'background' });
  expect(html).toContain('data-tone-as="background"');
  expect(html).toContain('--tone:var(--color-ok)');
});

test('a value no mapping matches has no tone, whatever toneAs says', () => {
  const high: Mapping[] = [{ match: { from: 5 }, tone: 'bad' }];
  const html = render([1.5], { mappings: high, toneAs: 'background' });
  expect(html).toContain('>1.5</span>');
  expect(html).not.toContain('data-tone-as');
});

test('a mapped text replaces the format: no value reads 0, true reads Yes, a state its name', () => {
  const none: Mapping[] = [{ match: { null: true }, text: '0' }];
  expect(render([], { mappings: none })).toContain('>0</span>');
  expect(render([null], { mappings: none })).toContain('>0</span>');
  const yes: Mapping[] = [{ match: { value: true }, text: 'Yes', tone: 'good' }];
  expect(render([false, true], { mappings: yes })).toContain('>Yes</span>');
  const states: Mapping[] = [{ match: { value: 'degraded' }, text: 'Degraded', tone: 'warning' }];
  const named = { mappings: states, field: 'value' };
  expect(render(['ready', 'degraded'], named)).toContain('>Degraded</span>');
  expect(render(['ready'], named)).toContain('>ready</span>');
});

test('a text longer than a line wraps at the size a line fits, and a shorter one stays on one line', () => {
  const text = 'Degraded since the last deploy of the checkout service';
  const long: Mapping[] = [{ match: { null: true }, text }];
  const html = render([], { mappings: long });
  expect(html).toContain('font-size:min(32px, 6.72cqi)');
  expect(html).toContain('white-space:normal');
  expect(html).toContain('overflow-wrap:anywhere');
  const short = render([], { mappings: [{ match: { null: true }, text: 'Degraded' }] });
  expect(short).toContain('white-space:nowrap');
  expect(short).toContain('font-size:min(32px, 20.16cqi)');
  // A number is never wrapped.
  expect(render([123456789.25])).toContain('white-space:nowrap');
});
