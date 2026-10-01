/**
 * Expands the option's series templates into ECharts series: one per value column when a role
 * names several, one per dataset when the rows were split into groups. Marks on a template go on
 * its first series only, so a threshold is drawn once.
 */
import { createFormatter, type MarkerOutcome, type RoleColumns } from '@quanthea/shared';
import { isObject, type Loose } from './loose.ts';
import type { Prepared } from './prepare/types.ts';
import { allColumns } from './roles.ts';
import type { ChartTheme } from './theme.ts';

/** Series types that draw one item per category rather than points on axes. */
const itemTypes: ReadonlySet<unknown> = new Set(['pie', 'funnel', 'gauge']);

/** Keys drawn once per template, on its first series. */
const markKeys = ['markLine', 'markArea', 'markPoint'] as const;

/**
 * The encode of a template that has none, such as a gauge's: an item chart reads its category and
 * first value, a chart on axes every value column.
 *
 * @param template - The template.
 * @param horizontal - Whether categories run along the y axis.
 * @param roles - The columns of each role.
 * @returns The encode, in columns or role tokens.
 */
function defaultEncode(template: Loose, horizontal: boolean, roles: RoleColumns): Loose {
  if (itemTypes.has(template.type)) {
    const itemName = allColumns(roles, 'category')[0] ?? allColumns(roles, 'x')[0];
    const value = allColumns(roles, 'value')[0] ?? allColumns(roles, 'y')[0];
    return { itemName, value };
  }
  return horizontal ? { x: '@y', y: '@x' } : { x: '@x', y: '@y' };
}

/**
 * The role a template's encode spreads over: the first role token naming several columns.
 *
 * @param encode - The encode.
 * @param roles - The columns of each role.
 * @returns The role, if one names several columns.
 */
function spreadRole(encode: Loose, roles: RoleColumns): string | undefined {
  const tokens = Object.values(encode).filter(
    (value): value is string => typeof value === 'string' && value.startsWith('@'),
  );
  return tokens.map((token) => token.slice(1)).find((name) => Array.isArray(roles[name]));
}

/**
 * An encode with its role tokens replaced by columns; a role without a column drops its key.
 *
 * @param encode - The encode.
 * @param roles - The columns of each role.
 * @param spread - The role spread over, and the column this series takes from it.
 * @returns The encode.
 */
function resolveEncode(
  encode: Loose,
  roles: RoleColumns,
  spread?: { role: string; column: string },
): Loose {
  const resolve = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(resolve);
    if (typeof value !== 'string' || !value.startsWith('@')) return value;
    const name = value.slice(1);
    if (spread?.role === name) return spread.column;
    return allColumns(roles, name)[0];
  };
  const entries = Object.entries(encode).map(([key, value]) => [key, resolve(value)] as const);
  return Object.fromEntries(entries.filter(([, value]) => value !== undefined));
}

/**
 * One series of a template: its encode resolved, named after the column it draws. Only the first
 * series of a template keeps its marks.
 *
 * @param template - The template.
 * @param encode - The template's encode.
 * @param roles - The columns of each role.
 * @param spread - The role spread over and this series' column, if any.
 * @param first - Whether it is the template's first series.
 * @returns The series.
 */
function oneSeries(
  template: Loose,
  encode: Loose,
  roles: RoleColumns,
  spread: { role: string; column: string } | undefined,
  first: boolean,
): Loose {
  const resolved = resolveEncode(encode, roles, spread);
  const last = Object.values(resolved).at(-1);
  const name = template.name ?? spread?.column ?? (typeof last === 'string' ? last : undefined);
  const series: Loose = {
    ...template,
    name,
    datasetIndex: template.datasetIndex ?? 0,
    encode: resolved,
  };
  if (!first) for (const key of markKeys) delete series[key];
  return series;
}

/**
 * The series of one template.
 *
 * @param template - The template.
 * @param prepared - The prepared data.
 * @param horizontal - Whether categories run along the y axis.
 * @returns The series.
 */
function seriesOf(template: Loose, prepared: Prepared, horizontal: boolean): Loose[] {
  const { roles } = prepared;
  const encode = isObject(template.encode)
    ? template.encode
    : defaultEncode(template, horizontal, roles);
  if (prepared.groups) {
    const resolved = resolveEncode(encode, roles);
    return prepared.groups.map((name, datasetIndex) => ({
      ...template,
      name,
      datasetIndex,
      encode: resolved,
    }));
  }
  const role = spreadRole(encode, roles);
  if (!role) return [oneSeries(template, encode, roles, undefined, true)];
  return allColumns(roles, role).map((column, index) =>
    oneSeries(template, encode, roles, { role, column }, index === 0),
  );
}

/**
 * Expands the templates.
 *
 * @param prepared - The prepared data and option.
 * @returns The series.
 */
export function expandSeries(prepared: Prepared): Loose[] {
  const templates = [prepared.option.series ?? []].flat().filter(isObject);
  if (prepared.expanded) return templates;
  const horizontal = isObject(prepared.option.yAxis) && prepared.option.yAxis.type === 'category';
  return templates.flatMap((template) => seriesOf(template, prepared, horizontal));
}

/**
 * Adds the annotation markers to the first series, as dashed vertical lines labelled with their
 * time and text. The labels are drawn on the canvas, never as HTML.
 *
 * @param series - The series.
 * @param markers - The markers of the panel.
 * @param theme - The chart theme.
 * @param timeZone - The time zone of the labels.
 * @returns The series, the first with a `markLine`.
 */
export function withMarkers(
  series: readonly Loose[],
  markers: readonly MarkerOutcome[],
  theme: ChartTheme,
  timeZone: string | undefined,
): Loose[] {
  const [first, ...rest] = series;
  const time = createFormatter({ $fmt: 'datetime', pattern: 'time' }, { timeZone });
  const data = markers.flatMap((marker) =>
    marker.points.map((point) => ({
      xAxis: point.time,
      name: `${time(point.time)} ${point.text}`,
    })),
  );
  if (!first || data.length === 0) return [...series];
  const markLine = {
    symbol: ['none', 'none'],
    silent: true,
    animation: false,
    lineStyle: { color: theme.ink, type: 'dashed', width: 1 },
    label: {
      formatter: '{b}',
      position: 'end',
      color: theme.surface,
      backgroundColor: theme.ink,
      padding: [3, 6],
      borderRadius: 4,
      fontFamily: theme.monoFamily,
      fontSize: 11,
    },
    data,
  };
  return [{ ...first, markLine }, ...rest];
}
