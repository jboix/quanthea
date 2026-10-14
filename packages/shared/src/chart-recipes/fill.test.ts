import { describe, expect, test } from 'bun:test';
import type { Dataset } from '../dataset/contract.ts';
import { chartRecipe } from './catalogue.ts';
import { type ChartChoice, fillView } from './fill.ts';

/** Three columns of a table of hosts. */
const hosts: Dataset = {
  dimensions: [
    { name: 'host', type: 'string' },
    { name: 'errors', type: 'number' },
    { name: 'share', type: 'number' },
  ],
  source: [['a', 3, 0.5]],
};

/**
 * A table recipe filled with a choice.
 *
 * @param choice - The roles and the options.
 * @param dataset - The data, when the query has run.
 * @returns The view, or the problems.
 */
function tableOf(choice: Omit<ChartChoice, 'recipe'>, dataset?: Dataset) {
  const recipe = chartRecipe('table.rows');
  if (!recipe) throw new Error('No table recipe.');
  return fillView(recipe, { recipe: recipe.id, ...choice }, ['A'], dataset);
}

describe('the columns of a table', () => {
  test('are the columns of the roles when no option names one', () => {
    expect(tableOf({}, hosts)).toEqual({
      view: {
        kind: 'table',
        ref: 'A',
        columns: [{ field: 'host' }, { field: 'errors' }, { field: 'share' }],
      },
    });
    expect(tableOf({ roles: { columns: ['share', 'host'] } })).toEqual({
      view: { kind: 'table', ref: 'A', columns: [{ field: 'share' }, { field: 'host' }] },
    });
  });

  test('keep every column when an option changes one, in the order of the roles', () => {
    const overrides = {
      columns: [
        { field: 'share', format: { $fmt: 'percent' }, align: 'right' },
        { field: 'host', label: 'Host' },
      ],
      limit: 20,
    };
    expect(tableOf({ overrides }, hosts)).toEqual({
      view: {
        kind: 'table',
        ref: 'A',
        limit: 20,
        columns: [
          { field: 'host', label: 'Host' },
          { field: 'errors' },
          { field: 'share', format: { $fmt: 'percent' }, align: 'right' },
        ],
      },
    });
  });

  test('refuse an option for a field that is not a column, naming it', () => {
    const overrides = { columns: [{ field: 'host', label: 'Host' }, { field: 'region' }] };
    expect(tableOf({ overrides }, hosts)).toEqual({
      problems: [
        'options.columns names "region", which the table does not show. Its columns are "host", "errors", "share": name a column to show in roles.columns.',
      ],
    });
    expect(tableOf({ overrides, roles: { columns: ['errors'] } })).toEqual({
      problems: [
        'options.columns names "host", "region", which the table does not show. Its columns are "errors": name a column to show in roles.columns.',
      ],
    });
  });

  test('refuse options that are not a list of columns', () => {
    const problems = [
      'options.columns is a list of { "field", "label"?, "format"?, "align"?, "mappings"?, "toneAs"?, "width"? }, one for each column to change.',
    ];
    expect(tableOf({ overrides: { columns: { host: { label: 'Host' } } } }, hosts)).toEqual({
      problems,
    });
    expect(tableOf({ overrides: { columns: [{ label: 'Host' }] } }, hosts)).toEqual({ problems });
  });

  test('are the columns of the options until the roles are known', () => {
    const overrides = { columns: [{ field: 'share', label: 'Share' }] };
    expect(tableOf({ overrides })).toEqual({
      view: { kind: 'table', ref: 'A', columns: [{ field: 'share', label: 'Share' }] },
    });
  });

  test('take the mappings and the way a tone is drawn from the options', () => {
    const mappings = [
      { match: { null: true as const }, text: 'none' },
      { match: { from: 0.05 }, tone: 'bad' as const },
    ];
    const toneAs = 'background' as const;
    const overrides = { columns: [{ field: 'share', mappings, toneAs }] };
    expect(tableOf({ overrides }, hosts)).toEqual({
      view: {
        kind: 'table',
        ref: 'A',
        columns: [{ field: 'host' }, { field: 'errors' }, { field: 'share', mappings, toneAs }],
      },
    });
  });

  test('refuse an option with a key a column does not take', () => {
    const overrides = { columns: [{ field: 'host', color: 'red' }] };
    expect(tableOf({ overrides }, hosts)).toEqual({
      problems: [
        'options.columns is a list of { "field", "label"?, "format"?, "align"?, "mappings"?, "toneAs"?, "width"? }, one for each column to change.',
      ],
    });
  });

  test('refuse options that list every column in another order, unless the roles name them', () => {
    const overrides = { columns: [{ field: 'share' }, { field: 'errors' }, { field: 'host' }] };
    expect(tableOf({ overrides }, hosts)).toEqual({
      problems: [
        'options.columns lists the columns as "share", "errors", "host", and the table shows them as "host", "errors", "share": options.columns does not order them. Name the columns in roles.columns, in the order to show.',
      ],
    });
    const roles = { columns: ['errors', 'host', 'share'] };
    expect(tableOf({ overrides, roles }, hosts)).toMatchObject({
      view: { columns: [{ field: 'errors' }, { field: 'host' }, { field: 'share' }] },
    });
    const inOrder = { columns: [{ field: 'host' }, { field: 'errors' }, { field: 'share' }] };
    expect(tableOf({ overrides: inOrder }, hosts)).toMatchObject({ view: { kind: 'table' } });
  });

  test('show a column once when the roles name it twice', () => {
    expect(tableOf({ roles: { columns: ['host', 'errors', 'host'] } }, hosts)).toEqual({
      view: { kind: 'table', ref: 'A', columns: [{ field: 'host' }, { field: 'errors' }] },
    });
  });
});

/**
 * A chart recipe filled with options, on its own sample.
 *
 * @param id - The recipe's id.
 * @param overrides - The options.
 * @returns The view, or the problems.
 */
function chartOf(id: string, overrides: NonNullable<ChartChoice['overrides']>) {
  const recipe = chartRecipe(id);
  if (!recipe) throw new Error(`No recipe ${id}.`);
  return fillView(recipe, { recipe: id, overrides }, ['A'], recipe.sample.datasets[0]);
}

describe('the mappings of a chart', () => {
  const mappings = [
    { match: { to: 0.7 }, tone: 'good' },
    { match: { from: 0.7, to: 0.9 }, tone: 'warning' },
    { match: { from: 0.9 }, tone: 'bad' },
  ];

  test('leave the options of a gauge for its view, and the rest stays in the option', () => {
    const filled = chartOf('kpi.gauge', { mappings, series: { max: 2 } });
    expect(filled).toMatchObject({
      view: { kind: 'chart', prepare: 'gauge', mappings, option: { series: [{ max: 2 }] } },
    });
    const view = 'view' in filled && filled.view.kind === 'chart' ? filled.view : undefined;
    expect(Object.keys(view?.option ?? {})).toEqual(['series']);
  });

  test('written inside the gauge series still reach its view, and leave the series', () => {
    const filled = chartOf('kpi.gauge', { series: { max: 2, mappings } });
    expect(filled).toMatchObject({ view: { mappings, option: { series: [{ max: 2 }] } } });
    const view = 'view' in filled && filled.view.kind === 'chart' ? filled.view : undefined;
    const [series] = (view?.option.series ?? []) as Record<string, unknown>[];
    expect(series && 'mappings' in series).toBe(false);
  });

  test('are no field of a view whose options name none', () => {
    const filled = chartOf('kpi.gauge', { series: { max: 2 } });
    expect('view' in filled && 'mappings' in filled.view).toBe(false);
  });

  test('leave the value a legend shows to the view', () => {
    const filled = chartOf('trend.line', { legendValues: 'mean' });
    expect(filled).toMatchObject({ view: { legendValues: 'mean' } });
    const view = 'view' in filled && filled.view.kind === 'chart' ? filled.view : undefined;
    expect(view?.option).not.toHaveProperty('legendValues');
  });

  test('reach the view of any chart, where validation refuses them on all but a gauge', () => {
    expect(chartOf('kpi.big-number', { mappings })).toMatchObject({ view: { mappings } });
  });
});
