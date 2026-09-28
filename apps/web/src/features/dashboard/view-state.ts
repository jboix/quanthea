/**
 * What a viewer changed, kept in the URL: the time range (`from`, `to`) and the variables
 * (`var-env=prod`, repeated for several values). Sharing the link shares the view; the saved
 * dashboard never changes.
 */
import {
  createFormatter,
  type DashboardSpec,
  type TimeRangeExpression,
  timeRangeSchema,
  type VariableValues,
} from '@querent/shared';

/** The viewer's choices. */
export interface ViewChoices {
  /** Variable values by name; missing names take their defaults. */
  readonly variables: VariableValues;
  /** The time range, or `undefined` for the saved one. */
  readonly time: TimeRangeExpression | undefined;
}

/** The quick ranges of the time picker. */
export const quickRanges: readonly { readonly from: string; readonly label: string }[] = [
  { from: 'now-15m', label: 'Last 15 minutes' },
  { from: 'now-1h', label: 'Last hour' },
  { from: 'now-6h', label: 'Last 6 hours' },
  { from: 'now-24h', label: 'Last 24 hours' },
  { from: 'now-7d', label: 'Last 7 days' },
  { from: 'now-30d', label: 'Last 30 days' },
];

/** The unit names of relative times. */
const unitNames: Readonly<Record<string, string>> = {
  s: 'second',
  m: 'minute',
  h: 'hour',
  d: 'day',
  w: 'week',
  M: 'month',
  y: 'year',
};

/** The URL parameter prefix of a variable. */
const variablePrefix = 'var-';

/**
 * Reads the viewer's choices from the URL.
 *
 * @param search - The URL's search parameters.
 * @param spec - The spec, for the declared variables.
 * @returns The choices. Invalid times and undeclared variables are ignored.
 */
export function choicesFromSearch(search: URLSearchParams, spec: DashboardSpec): ViewChoices {
  const time = timeRangeSchema.safeParse({ from: search.get('from'), to: search.get('to') });
  const entries = spec.variables.flatMap((variable) => {
    const values = search.getAll(`${variablePrefix}${variable.name}`);
    if (values.length === 0) return [];
    const multi = variable.kind !== 'text' && variable.multi === true;
    return [[variable.name, multi ? values : (values[0] ?? '')] as const];
  });
  return { variables: Object.fromEntries(entries), time: time.success ? time.data : undefined };
}

/**
 * The URL parameters with a new time range.
 *
 * @param search - The current parameters.
 * @param time - The range, or `undefined` to go back to the saved one.
 * @returns New parameters.
 */
export function withTime(
  search: URLSearchParams,
  time: TimeRangeExpression | undefined,
): URLSearchParams {
  const next = new URLSearchParams(search);
  next.delete('from');
  next.delete('to');
  if (time) {
    next.set('from', time.from);
    next.set('to', time.to);
  }
  return next;
}

/**
 * The URL parameters with a new variable value.
 *
 * @param search - The current parameters.
 * @param name - The variable.
 * @param value - One value or several.
 * @returns New parameters.
 */
export function withVariable(
  search: URLSearchParams,
  name: string,
  value: string | readonly string[],
): URLSearchParams {
  const next = new URLSearchParams(search);
  next.delete(`${variablePrefix}${name}`);
  for (const each of [value].flat()) next.append(`${variablePrefix}${name}`, each);
  return next;
}

/**
 * Describes a relative range ending now.
 *
 * @param range - The range as expressions.
 * @returns Such as `Last 6 hours`, or `undefined` for any other range.
 */
function relativeLabel(range: TimeRangeExpression): string | undefined {
  const relative = /^now-(\d+)([smhdwMy])$/.exec(range.from);
  if (!relative || range.to !== 'now') return undefined;
  const [, amount, unit] = relative;
  const name = unitNames[unit ?? ''] ?? unit;
  return amount === '1' ? `Last ${name}` : `Last ${amount} ${name}s`;
}

/**
 * Describes a time range for the variables bar.
 *
 * @param range - The range as expressions.
 * @param timeZone - The zone for absolute times.
 * @returns Such as `Last 6 hours` or `26 Sep, 13:30 – 15:00`.
 */
export function timeLabel(range: TimeRangeExpression, timeZone?: string): string {
  const relative = relativeLabel(range);
  if (relative !== undefined) return relative;
  const [from, to] = [Date.parse(range.from), Date.parse(range.to)];
  if (Number.isNaN(from) || Number.isNaN(to)) return `${range.from} – ${range.to}`;
  const dateTime = createFormatter({ $fmt: 'datetime' }, { timeZone });
  const date = createFormatter({ $fmt: 'datetime', pattern: 'date' }, { timeZone });
  const time = createFormatter({ $fmt: 'datetime', pattern: 'time' }, { timeZone });
  const end = date(from) === date(to) ? time(to) : dateTime(to);
  return `${dateTime(from)} – ${end}`;
}
