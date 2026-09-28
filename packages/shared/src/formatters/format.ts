/**
 * The named formatter library: pure functions from a value to display text, shared by the chart
 * adapter, stat panels and tables.
 */
import type { Formatter, NamedFormatter } from './schema.ts';

/** What formatting depends on besides the value. */
export interface FormatOptions {
  /** The IANA time zone for dates, or the runtime's zone when omitted. */
  readonly timeZone?: string | undefined;
  /** The current instant, for relative dates. */
  readonly now?: number;
}

/** A formatter ready to call. */
export type FormatFunction = (value: unknown) => string;

/** The locale of formatted numbers and dates. */
const locale = 'en';

/** Scales for durations, from the smallest, in seconds. */
const durationUnits = [
  { suffix: 'ns', seconds: 1e-9 },
  { suffix: 'µs', seconds: 1e-6 },
  { suffix: 'ms', seconds: 1e-3 },
  { suffix: 's', seconds: 1 },
  { suffix: 'min', seconds: 60 },
  { suffix: 'h', seconds: 3600 },
  { suffix: 'd', seconds: 86_400 },
] as const;

/** Seconds per input unit of a duration. */
const durationInput = { ns: 1e-9, us: 1e-6, ms: 1e-3, s: 1 } as const;

/** SI prefixes by power of 1000, from 10⁻⁹ to 10¹⁵. */
const siPrefixes = ['n', 'µ', 'm', '', 'k', 'M', 'G', 'T', 'P'] as const;

/** Byte units by power of the base. */
const byteUnits = {
  1000: ['B', 'kB', 'MB', 'GB', 'TB', 'PB'],
  1024: ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'],
} as const;

/**
 * Formats a number with at most `decimals` fraction digits.
 *
 * @param value - The number.
 * @param decimals - The most fraction digits.
 * @param compact - Whether to write `1.2K` instead of `1,234`.
 * @returns The text.
 */
function plain(value: number, decimals: number, compact = false): string {
  const notation = compact ? 'compact' : 'standard';
  return new Intl.NumberFormat(locale, { maximumFractionDigits: decimals, notation }).format(value);
}

/**
 * Reads a value as a number.
 *
 * @param value - A frame value.
 * @returns The number, or `undefined` for anything that is not a finite number.
 */
function numberOf(value: unknown): number | undefined {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) ? number : undefined;
}

/**
 * Picks the largest scale a value reaches, by the exponent of a base.
 *
 * @param value - The value.
 * @param base - The base, such as 1000.
 * @param lowest - The lowest exponent allowed.
 * @param highest - The highest exponent allowed.
 * @returns The exponent.
 */
function exponentOf(value: number, base: number, lowest: number, highest: number): number {
  if (value === 0) return 0;
  const exponent = Math.floor(Math.log(Math.abs(value)) / Math.log(base));
  return Math.min(highest, Math.max(lowest, exponent));
}

/**
 * Formats a duration in the largest unit it reaches.
 *
 * @param seconds - The duration in seconds.
 * @param decimals - The most fraction digits.
 * @returns Such as `2.9 s` or `310 ms`.
 */
function duration(seconds: number, decimals: number): string {
  const magnitude = Math.abs(seconds);
  const unit =
    [...durationUnits].reverse().find((candidate) => magnitude >= candidate.seconds) ??
    durationUnits[0];
  return `${plain(seconds / unit.seconds, decimals)} ${unit.suffix}`;
}

/**
 * Formats a number with an SI prefix.
 *
 * @param value - The number.
 * @param unit - The unit after the prefix, if any.
 * @param decimals - The most fraction digits.
 * @returns Such as `2.3 kreq/s`.
 */
function si(value: number, unit: string, decimals: number): string {
  const exponent = exponentOf(value, 1000, -3, 5);
  const text = `${plain(value / 1000 ** exponent, decimals)} ${siPrefixes[exponent + 3]}${unit}`;
  return text.trimEnd();
}

/**
 * Formats a byte count.
 *
 * @param value - The bytes.
 * @param base - 1000 for kB, 1024 for KiB.
 * @param decimals - The most fraction digits.
 * @returns Such as `1.5 MiB`.
 */
function bytes(value: number, base: 1000 | 1024, decimals: number): string {
  const exponent = exponentOf(value, base, 0, 5);
  return `${plain(value / base ** exponent, decimals)} ${byteUnits[base][exponent]}`;
}

/**
 * Formats an instant as `26 Sep`, `14:02` or `26 Sep, 14:02`: day before month, 24-hour clock.
 *
 * @param instant - Epoch milliseconds.
 * @param pattern - `time`, `date`, `datetime` or `relative`.
 * @param options - The time zone and the current instant.
 * @returns The text.
 */
function datetime(instant: number, pattern: string, options: FormatOptions): string {
  if (pattern === 'relative') return relative(instant, options.now ?? Date.now());
  const parts = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: options.timeZone,
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? '';
  const date = `${part('day')} ${part('month')}`;
  const time = `${part('hour')}:${part('minute')}`;
  if (pattern === 'time') return time;
  return pattern === 'date' ? date : `${date}, ${time}`;
}

/**
 * Formats an instant relative to now.
 *
 * @param instant - Epoch milliseconds.
 * @param now - The current instant.
 * @returns Such as `5 minutes ago`.
 */
function relative(instant: number, now: number): string {
  const seconds = (instant - now) / 1000;
  const unit = [...durationUnits]
    .reverse()
    .find((candidate) => Math.abs(seconds) >= candidate.seconds);
  const [name, size] = unitForRelative(unit?.suffix);
  return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(
    Math.round(seconds / size),
    name,
  );
}

/**
 * The relative-time unit for a duration suffix.
 *
 * @param suffix - The duration suffix, such as `min`.
 * @returns The Intl unit and its size in seconds.
 */
function unitForRelative(suffix: string | undefined): [Intl.RelativeTimeFormatUnit, number] {
  if (suffix === 'd') return ['day', 86_400];
  if (suffix === 'h') return ['hour', 3600];
  if (suffix === 'min') return ['minute', 60];
  return ['second', 1];
}

/**
 * Formats an amount of money.
 *
 * @param value - The amount.
 * @param code - The ISO 4217 currency code.
 * @param decimals - The fraction digits, or the currency's own when omitted.
 * @returns Such as `€1,284.50`.
 */
function currency(value: number, code: string, decimals: number | undefined): string {
  const digits =
    decimals === undefined
      ? {}
      : { minimumFractionDigits: decimals, maximumFractionDigits: decimals };
  return new Intl.NumberFormat(locale, { style: 'currency', currency: code, ...digits }).format(
    value,
  );
}

/** Formats a number with one kind of named formatter. */
type NamedFormat<Name extends NamedFormatter['$fmt']> = (
  named: Extract<NamedFormatter, { $fmt: Name }>,
  value: number,
  options: FormatOptions,
) => string;

/** The implementation of each named formatter, with its defaults. */
const namedFormats: { readonly [Name in NamedFormatter['$fmt']]: NamedFormat<Name> } = {
  number: (named, value) => plain(value, named.decimals ?? 2, named.compact),
  percent: (named, value) =>
    `${plain(named.input === 'percent' ? value : value * 100, named.decimals ?? 1)}%`,
  bytes: (named, value) => bytes(value, named.base ?? 1024, named.decimals ?? 1),
  duration: (named, value) => duration(value * durationInput[named.unit], named.decimals ?? 1),
  si: (named, value) => si(value, named.unit ?? '', named.decimals ?? 1),
  currency: (named, value) => currency(value, named.code, named.decimals),
  datetime: (named, value, options) => datetime(value, named.pattern ?? 'datetime', options),
};

/**
 * Formats a number with a named formatter.
 *
 * @param named - The formatter.
 * @param value - The number.
 * @param options - The time zone and the current instant.
 * @returns The text.
 */
function formatNamed(named: NamedFormatter, value: number, options: FormatOptions): string {
  // The entry is picked by `named.$fmt`, which TypeScript cannot correlate with `named`.
  const format = namedFormats[named.$fmt] as NamedFormat<NamedFormatter['$fmt']>;
  return format(named as never, value, options);
}

/**
 * Builds a function that formats values with a formatter. A string template replaces `{value}`
 * with the value as it is. A named formatter formats numbers; any other value is shown as text.
 *
 * @param formatter - The formatter from the spec.
 * @param options - The time zone and the current instant.
 * @returns The function. `null` and `undefined` become an empty string.
 */
export function createFormatter(formatter: Formatter, options: FormatOptions = {}): FormatFunction {
  return (value) => {
    if (value === null || value === undefined) return '';
    if (typeof formatter === 'string') return formatter.replaceAll('{value}', String(value));
    const number = numberOf(value);
    return number === undefined ? String(value) : formatNamed(formatter, number, options);
  };
}
