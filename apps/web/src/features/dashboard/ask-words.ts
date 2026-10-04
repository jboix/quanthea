/**
 * The words of the Ask tab: an answer's text cut into words and citation markers, and the lines
 * that say what a question was asked about. Plain text only: nothing the model writes is read as
 * markup.
 */
import {
  allValue,
  type DashboardSpec,
  resolveTimeRange,
  type TimeRangeExpression,
  type VariableValues,
} from '@quanthea/shared';

/** A piece of an answer's text, at its offset: words, or a citation marker such as `[2]`. */
export type AnswerSegment =
  | { readonly kind: 'text'; readonly at: number; readonly text: string }
  | { readonly kind: 'marker'; readonly at: number; readonly n: number };

/**
 * Cuts an answer's text into words and citation markers.
 *
 * @param text - The answer's text, with markers such as `[1]`.
 * @returns The pieces, in order.
 */
export function answerSegments(text: string): AnswerSegment[] {
  const segments: AnswerSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(/\[(\d{1,2})\]/g)) {
    if (match.index > last)
      segments.push({ kind: 'text', at: last, text: text.slice(last, match.index) });
    segments.push({ kind: 'marker', at: match.index, n: Number(match[1]) });
    last = match.index + match[0].length;
  }
  if (last < text.length) segments.push({ kind: 'text', at: last, text: text.slice(last) });
  return segments;
}

/** The months' short names, the same in every browser whatever its locale data. */
const monthNames = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');

/**
 * Formats an instant as a short day and a time of day in a time zone.
 *
 * @param instant - Epoch milliseconds.
 * @param timeZone - An IANA time zone.
 * @returns The day, such as `26 Sep`, and the time, such as `13:30`.
 */
function dayAndTime(instant: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).formatToParts(new Date(instant));
  const part = (type: string) => parts.find((each) => each.type === type)?.value ?? '';
  const month = monthNames[Number(part('month')) - 1] ?? part('month');
  return { day: `${part('day')} ${month}`, time: `${part('hour')}:${part('minute')}` };
}

/**
 * Describes an absolute range in a time zone, the day once when it fits in one.
 *
 * @param range - The range, in epoch milliseconds.
 * @param timeZone - An IANA time zone.
 * @returns Such as `26 Sep 13:30–15:00` or `26 Sep 22:00 – 27 Sep 02:00`.
 */
export function absoluteRangeLabel(
  range: { readonly from: number; readonly to: number },
  timeZone: string,
): string {
  const from = dayAndTime(range.from, timeZone);
  const to = dayAndTime(range.to, timeZone);
  if (from.day === to.day) return `${from.day} ${from.time}–${to.time}`;
  return `${from.day} ${from.time} – ${to.day} ${to.time}`;
}

/**
 * Describes the day of an instant in a time zone.
 *
 * @param instant - Epoch milliseconds.
 * @param timeZone - An IANA time zone.
 * @returns Such as `26 Sep`.
 */
export function dayLabel(instant: number, timeZone: string): string {
  return dayAndTime(instant, timeZone).day;
}

/**
 * Describes an instant in a time zone.
 *
 * @param instant - Epoch milliseconds.
 * @param timeZone - An IANA time zone.
 * @returns Such as `26 Sep 14:10`.
 */
export function instantLabel(instant: number, timeZone: string): string {
  const { day, time } = dayAndTime(instant, timeZone);
  return `${day} ${time}`;
}

/**
 * Describes a variable's value.
 *
 * @param value - One value or several.
 * @returns Such as `prod`, `All`, or `api + web`.
 */
function valueWords(value: string | readonly string[]): string {
  const values = [value].flat();
  if (values.includes(allValue)) return 'All';
  return values.join(' + ');
}

/**
 * Describes the variable values shown: the chosen ones, else the defaults.
 *
 * @param spec - The spec.
 * @param variables - The chosen values.
 * @returns Such as `['$env prod', '$service All']`.
 */
export function variableWords(spec: DashboardSpec, variables: VariableValues): string[] {
  return spec.variables.flatMap((variable) => {
    const value = variables[variable.name] ?? variable.default;
    return value === undefined ? [] : [`$${variable.name} ${valueWords(value)}`];
  });
}

/**
 * Describes the variable values a question was asked with.
 *
 * @param variables - The values stored with the question.
 * @returns Such as `['$env prod', '$service All']`.
 */
export function storedVariableWords(variables: VariableValues): string[] {
  return Object.entries(variables).map(([name, value]) => `$${name} ${valueWords(value)}`);
}

/** What the dashboard shows, as the Ask tab describes it. */
export interface ShownContext {
  /** The spec. */
  readonly spec: DashboardSpec;
  /** The range shown, or `undefined` for the saved one. */
  readonly time: TimeRangeExpression | undefined;
  /** The chosen variable values. */
  readonly variables: VariableValues;
  /** The time zone, the dashboard's or else the browser's. */
  readonly timeZone: string;
  /** The current instant, which relative ranges end at. */
  readonly now: number;
}

/**
 * The label of the question box: what a question will be asked about, with absolute times.
 *
 * @param shown - What the dashboard shows.
 * @returns Such as `Ask about this dashboard, as shown: 26 Sep 13:30–15:00, $env prod`.
 */
export function contextLabel(shown: ShownContext): string {
  const range = resolveTimeRange(shown.time ?? shown.spec.time, shown.now);
  const parts = [
    absoluteRangeLabel(range, shown.timeZone),
    ...variableWords(shown.spec, shown.variables),
  ];
  return `Ask about this dashboard, as shown: ${parts.join(', ')}`;
}
