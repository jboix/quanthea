/**
 * The condition of a draft as a sentence of values a person can change by hand: the series it
 * tells apart, the operator and threshold, how long it must hold, and how often it is checked.
 * Each change returns the whole spec, which the hand edit saves as a new version.
 */
import { type AlertSpec, alertValueText, durationMs } from '@quanthea/shared';

/** Units of a duration in words. */
const unitWords: Readonly<Record<string, [string, string]>> = {
  s: ['second', 'seconds'],
  m: ['minute', 'minutes'],
  h: ['hour', 'hours'],
  d: ['day', 'days'],
};

/**
 * A duration in words.
 *
 * @param duration - Such as `5m`.
 * @returns Such as `5 minutes`, or `at once` for none.
 */
export function durationWords(duration: string): string {
  const match = /^(\d+)([smhd])$/.exec(duration);
  if (!match) return duration;
  const count = Number(match[1]);
  if (count === 0) return 'at once';
  const [one, many] = unitWords[match[2] ?? 'm'] ?? ['', ''];
  return count === 1 ? `1 ${one}` : `${count} ${many}`;
}

/**
 * How often an alert is checked, in words.
 *
 * @param every - Such as `1m`.
 * @returns Such as `every minute` or `every 5 minutes`.
 */
export function everyWords(every: string): string {
  const words = durationWords(every);
  return words.startsWith('1 ') ? `every ${words.slice(2)}` : `every ${words}`;
}

/**
 * The series a draft tells apart, in words.
 *
 * @param spec - The spec.
 * @returns Such as `each service`, or `each series`.
 */
export function byWords(spec: AlertSpec): string {
  const by = spec.value.by ?? [];
  return by.length > 0 ? `each ${by.join(' and ')}` : 'each series';
}

/**
 * The threshold in words.
 *
 * @param spec - The spec.
 * @param value - The threshold, if it moved from the spec's.
 * @returns Such as `above 2%`.
 */
export function thresholdWords(spec: AlertSpec, value?: number): string {
  const { condition } = spec;
  if (condition.kind !== 'threshold') return 'no data';
  return `${condition.op} ${alertValueText(spec, value ?? condition.value)}`;
}

/** Where the subject of an alert's title ends, such as before `above` in `Error share above 2%`. */
const subjectEnd =
  /\s+(?:above|below|over|under|exceeds|per|by|for|on|across|in|of each|is|[<>≥≤])(?:\s.*)?$/i;

/**
 * What an alert's title is about: the words before a condition or a breakdown, lower case unless
 * they start with an acronym.
 *
 * @param title - The title.
 * @returns Such as `checkout error share` for `Checkout error share per service`.
 */
function titleSubject(title: string): string {
  const subject = title.trim().replace(subjectEnd, '').trim();
  return /^[A-Z][a-z]/.test(subject) ? subject[0]?.toLowerCase() + subject.slice(1) : subject;
}

/**
 * A column's name as words.
 *
 * @param field - Such as `error_share` or `errorShare`.
 * @returns Such as `error share`.
 */
function fieldWords(field: string): string {
  return field
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/[_\-.]+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * What the alert watches, in words: the subject of its title, else its value's column as words.
 *
 * @param spec - The spec.
 * @returns Such as `the checkout error share`, `the error share`, or `the value`.
 */
export function watchWords(spec: Pick<AlertSpec, 'title' | 'value'>): string {
  const words = titleSubject(spec.title) || fieldWords(spec.value.field ?? '') || 'value';
  return /^the\s/i.test(words) ? words : `the ${words}`;
}

/**
 * The spec with another column compared.
 *
 * @param spec - The spec.
 * @param text - The column; none for the first number column.
 * @returns The new spec.
 */
export function withField(spec: AlertSpec, text: string): AlertSpec {
  const field = text.trim();
  const { field: _field, ...value } = spec.value;
  return { ...spec, value: field === '' ? value : { ...value, field } };
}

/**
 * The spec with a new threshold.
 *
 * @param spec - The spec, with a threshold condition.
 * @param op - Above or below.
 * @param value - The threshold.
 * @returns The new spec.
 */
export function withThreshold(spec: AlertSpec, op: 'above' | 'below', value: number): AlertSpec {
  const { condition } = spec;
  if (condition.kind !== 'threshold') return spec;
  return { ...spec, condition: { ...condition, op, value } };
}

/**
 * The spec with new columns telling series apart.
 *
 * @param spec - The spec.
 * @param text - The columns, separated by commas; none to tell them apart by default.
 * @returns The new spec.
 */
export function withBy(spec: AlertSpec, text: string): AlertSpec {
  const by = text
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name !== '');
  const { by: _by, ...value } = spec.value;
  return { ...spec, value: by.length > 0 ? { ...value, by } : value };
}

/**
 * The spec with a new `for`, keeping the window at least as long.
 *
 * @param spec - The spec.
 * @param duration - Such as `10m`.
 * @returns The new spec.
 */
export function withFor(spec: AlertSpec, duration: string): AlertSpec {
  const lookback = durationMs(spec.lookback) < durationMs(duration) ? duration : spec.lookback;
  return { ...spec, lookback, condition: { ...spec.condition, for: duration } };
}

/**
 * The spec with a new interval, keeping the repeat no more often.
 *
 * @param spec - The spec.
 * @param duration - Such as `5m`.
 * @returns The new spec.
 */
export function withEvery(spec: AlertSpec, duration: string): AlertSpec {
  const repeat = spec.notify.repeatEvery;
  const notify =
    repeat !== undefined && durationMs(repeat) < durationMs(duration)
      ? { ...spec.notify, repeatEvery: duration }
      : spec.notify;
  return { ...spec, every: duration, notify };
}

/**
 * Whether a text is a duration, such as `5m`.
 *
 * @param text - The text.
 * @returns Whether it reads as one.
 */
export function isDuration(text: string): boolean {
  return /^\d{1,5}[smhd]$/.test(text.trim());
}

/**
 * A threshold rounded for a drag: three significant digits.
 *
 * @param value - The value under the pointer.
 * @returns The rounded value.
 */
export function roundThreshold(value: number): number {
  if (value === 0 || !Number.isFinite(value)) return 0;
  return Number(value.toPrecision(3));
}
