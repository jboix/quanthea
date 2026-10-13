/**
 * What each panel of a built dashboard returned, kept small: its columns, how many rows, the
 * first rows, a summary of each number column, and the number a stat shows. The result checks
 * compare these with the truth, and the judge reads them to tell an empty panel from a full one.
 */
import {
  type Cell,
  type DashboardSpec,
  type Dataset,
  datasetOfFrames,
  type PanelRun,
  reduceResult,
} from '@quanthea/shared';

/** How many rows of a result are kept. A result with more says so. */
const keptRows = 40;

/** How many groups of a result get a total. */
const keptGroups = 60;

/** One column of a result. */
export interface ColumnSummary {
  /** Its name. */
  readonly name: string;
  /** Its type: `time`, `number`, `string` or `boolean`. */
  readonly type: string;
  /** For a number column: how many values it holds. */
  readonly count?: number;
  /** For a number column: its values added up. */
  readonly sum?: number;
  /** For a number column: its lowest value. */
  readonly min?: number;
  /** For a number column: its highest value. */
  readonly max?: number;
  /** For a number column of a result with a time column: when the highest value was. */
  readonly maxAt?: number;
}

/** One query's result. */
export interface QuerySummary {
  /** The query's refId. */
  readonly refId: string;
  /** Why it failed, when it did. */
  readonly error?: string;
  /** Its columns. */
  readonly columns: readonly ColumnSummary[];
  /** How many rows it returned. */
  readonly rowCount: number;
  /** Its first rows. */
  readonly rows: readonly (readonly Cell[])[];
  /** Whether it returned more rows than are kept. */
  readonly truncated: boolean;
  /**
   * For a result with one number column and one text column, or a `series` column that names
   * each series: the numbers added up per text, such as the events of each event name over a day.
   */
  readonly totals?: Readonly<Record<string, number>>;
}

/** One panel's results. */
export interface PanelResult {
  /** The panel. */
  readonly panelId: string;
  /** Each query's result. */
  readonly queries: readonly QuerySummary[];
  /** The number the panel shows, for a stat: its result reduced as its view says. */
  readonly shown?: number;
}

/**
 * The numbers of a column, each with its row.
 *
 * @param dataset - The result.
 * @param index - The column.
 * @returns The numbers, in row order.
 */
function numbersOf(dataset: Dataset, index: number): { value: number; row: readonly Cell[] }[] {
  return dataset.source.flatMap((row) => {
    const value = row[index];
    return typeof value === 'number' ? [{ value, row }] : [];
  });
}

/**
 * A number column's summary.
 *
 * @param dataset - The result.
 * @param index - The column.
 * @param timeIndex - The time column, or -1.
 * @returns The count, the sum, the lowest and the highest value, and when the highest was.
 */
function numberSummary(dataset: Dataset, index: number, timeIndex: number) {
  const numbers = numbersOf(dataset, index);
  const [first] = numbers;
  if (!first) return { count: 0 };
  const highest = numbers.reduce((best, each) => (each.value > best.value ? each : best), first);
  const maxAt = highest.row[timeIndex];
  return {
    count: numbers.length,
    sum: numbers.reduce((total, each) => total + each.value, 0),
    min: Math.min(...numbers.map((each) => each.value)),
    max: highest.value,
    ...(typeof maxAt === 'number' ? { maxAt } : {}),
  };
}

/**
 * The column a result's totals are per: the `series` column of series stacked into a long table,
 * else its one text column.
 *
 * @param dataset - The result.
 * @returns The column's index, or nothing when the result has several text columns and no series.
 */
function groupColumn(dataset: Dataset): number | undefined {
  const texts = dataset.dimensions.flatMap((column, at) => (column.type === 'string' ? [at] : []));
  const named = dataset.dimensions.findIndex((column) => column.name === 'series');
  if (texts.includes(named)) return named;
  return texts.length === 1 ? texts[0] : undefined;
}

/**
 * The numbers of a result added up per text: per series for series stacked into a long table, else
 * per value of its one text column. Only a result with one number column has them.
 *
 * @param dataset - The result.
 * @returns The field to spread; none for another shape, or for too many groups.
 */
function totalsField(dataset: Dataset): Pick<QuerySummary, 'totals'> {
  const numbers = dataset.dimensions.flatMap((column, at) =>
    column.type === 'number' ? [at] : [],
  );
  const text = groupColumn(dataset);
  const [number] = numbers;
  if (numbers.length !== 1 || text === undefined || number === undefined) return {};
  const totals: Record<string, number> = {};
  for (const { value, row } of numbersOf(dataset, number))
    totals[String(row[text])] = (totals[String(row[text])] ?? 0) + value;
  return Object.keys(totals).length > keptGroups ? {} : { totals };
}

/**
 * One query's result, kept small.
 *
 * @param query - The query's outcome.
 * @returns The summary.
 */
function querySummary(query: PanelRun['queries'][number]): QuerySummary {
  if (query.error)
    return {
      refId: query.refId,
      error: query.error.message,
      columns: [],
      rowCount: 0,
      rows: [],
      truncated: false,
    };
  const dataset = datasetOfFrames(query.frames);
  const timeIndex = dataset.dimensions.findIndex((column) => column.type === 'time');
  const columns = dataset.dimensions.map((column, at) => ({
    name: column.name,
    type: column.type,
    ...(column.type === 'number' ? numberSummary(dataset, at, timeIndex) : {}),
  }));
  return {
    refId: query.refId,
    columns,
    rowCount: dataset.source.length,
    rows: dataset.source.slice(0, keptRows),
    truncated: dataset.source.length > keptRows,
    ...totalsField(dataset),
  };
}

/**
 * The number a stat shows.
 *
 * @param panel - The panel.
 * @param run - Its run.
 * @returns The field to spread; none for another view, or a stat with no number.
 */
function shownField(
  panel: DashboardSpec['panels'][number],
  run: PanelRun,
): Pick<PanelResult, 'shown'> {
  if (panel.view.kind !== 'stat') return {};
  const { ref, reduce, field } = panel.view;
  const shown = reduceResult(run.queries, ref, reduce, field);
  return shown === undefined ? {} : { shown };
}

/**
 * What each panel of a spec returned, kept small.
 *
 * @param spec - The spec.
 * @param tests - Each panel's run.
 * @returns One result per panel that ran.
 */
export function panelResults(
  spec: DashboardSpec,
  tests: readonly { readonly panelId: string; readonly run: PanelRun }[],
): PanelResult[] {
  return tests.flatMap((test) => {
    const panel = spec.panels.find((each) => each.id === test.panelId);
    if (!panel) return [];
    const queries = test.run.queries.map(querySummary);
    return [{ panelId: test.panelId, queries, ...shownField(panel, test.run) }];
  });
}
