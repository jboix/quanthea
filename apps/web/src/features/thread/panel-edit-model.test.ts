import { describe, expect, test } from 'bun:test';
import type { Panel } from '@quanthea/shared';
import {
  differs,
  mainColour,
  textKey,
  unitOf,
  withMainColour,
  withQueryText,
  withWords,
} from './panel-edit-model.ts';

const chart: Panel = {
  id: 'errors',
  title: 'Errors',
  grid: { x: 0, y: 0, w: 6, h: 4 },
  queries: [
    { refId: 'A', connector: 'shop', language: 'sql', sql: 'SELECT 1' },
    { refId: 'B', connector: 'logs', language: 'redis', command: 'GET', args: ['k'] },
  ],
  view: {
    kind: 'chart',
    prepare: 'cartesian',
    roles: {},
    option: { series: [{ type: 'line' }] },
    datasets: [{ ref: 'A' }],
  },
};

describe('the main colour of a chart', () => {
  test('puts the token first and the other series colours after it', () => {
    const coloured = withMainColour(chart, '@palette.2');
    expect(mainColour(coloured)).toBe('@palette.2');
    expect(coloured.view.kind === 'chart' && coloured.view.option.color).toEqual([
      '@palette.2',
      '@palette.0',
      '@palette.1',
      '@palette.3',
      '@palette.4',
      '@palette.5',
    ]);
  });

  test('goes back to the theme’s order with no token', () => {
    const plain = withMainColour(withMainColour(chart, '@tone.bad'), undefined);
    expect(plain).toEqual(chart);
    expect(mainColour(plain)).toBeUndefined();
  });

  test('leaves a stat as it is', () => {
    const stat: Panel = {
      ...chart,
      view: { kind: 'stat', ref: 'A', reduce: 'last', format: { $fmt: 'number' } },
    };
    expect(withMainColour(stat, '@palette.1')).toBe(stat);
  });
});

describe('a query’s text', () => {
  test('changes the SQL, and leaves a language the form cannot edit', () => {
    const edited = withQueryText(withQueryText(chart, 'A', 'SELECT 2'), 'B', 'DEL k');
    expect(edited.queries[0]).toMatchObject({ sql: 'SELECT 2' });
    expect(edited.queries[1]).toEqual(chart.queries[1] as never);
    expect(textKey(chart.queries[1] as never)).toBeUndefined();
  });
});

describe('the words of a panel', () => {
  test('sets the title and leaves an empty description out', () => {
    const worded = withWords({ ...chart, description: 'Old' }, { title: 'Peak', description: ' ' });
    expect(worded.title).toBe('Peak');
    expect('description' in worded).toBe(false);
    expect(differs(worded, chart)).toBe(true);
  });
});

describe('the unit of a panel', () => {
  test('is the first formatter of its view that is a chart unit', () => {
    const option = { yAxis: { axisLabel: { formatter: { $fmt: 'percent', input: 'ratio' } } } };
    expect(unitOf({ ...chart, view: { ...chart.view, option } as Panel['view'] })).toBe('percent');
    expect(unitOf(chart)).toBe('number');
  });
});
