/**
 * Swaps the named formatters of a chart option for functions from the shared formatter library.
 * ECharts string templates pass through unchanged. No spec value ever becomes code.
 */
import { createFormatter, type FormatOptions, namedFormatterSchema } from '@querent/shared';

/** What ECharts passes a label formatter: the data item, with its dataset row and encoding. */
interface FormatterParams {
  /** The value, or the whole dataset row. */
  readonly value?: unknown;
  /** Which row columns each dimension reads. */
  readonly encode?: Readonly<Record<string, readonly number[]>>;
}

/**
 * The value a formatter call is about. Axis labels and tooltips pass the value; series labels pass
 * a params object whose `value` may be the whole dataset row.
 *
 * @param input - What ECharts passed.
 * @returns The value to format.
 */
function valueIn(input: unknown): unknown {
  if (typeof input !== 'object' || input === null || !('value' in input)) return input;
  const { value, encode } = input as FormatterParams;
  if (!Array.isArray(value)) return value;
  // A dataset row: read the encoded column that holds a number, whichever axis it is on.
  const columns = [encode?.value?.[0], encode?.y?.[0], encode?.x?.[0]];
  const column = columns.find((index) => index !== undefined && typeof value[index] === 'number');
  return column === undefined ? value : value[column];
}

/**
 * Replaces every named formatter in a value, at any depth.
 *
 * @param value - Part of a chart option.
 * @param options - The time zone for dates.
 * @returns The value with functions in place of `{ "$fmt": … }` objects.
 */
export function wireFormatters(value: unknown, options: FormatOptions): unknown {
  if (Array.isArray(value)) return value.map((item) => wireFormatters(item, options));
  if (typeof value !== 'object' || value === null) return value;
  const named = namedFormatterSchema.safeParse(value);
  if (named.success) {
    const format = createFormatter(named.data, options);
    return (input: unknown) => format(valueIn(input));
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, wireFormatters(child, options)]),
  );
}
