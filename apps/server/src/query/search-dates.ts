/** How a search reads a date written as text: the format a range or a histogram's bounds name. */

/**
 * The formats a range's bounds are read in when one is ISO 8601 text: that text, as `__from` and
 * `__to` are bound and as a model writes a date, or epoch milliseconds for a bound given as a number.
 */
export const boundFormat = 'strict_date_optional_time||epoch_millis';

/**
 * A date or a time in ISO 8601: `2026-10-05`, `2026-10-05T14:47`, `2026-10-05T14:47:01.250Z`,
 * with an offset or without, and any date math after `||`.
 */
const isoText =
  /^\d{4}-\d{2}-\d{2}(?:T\d{2}(?::\d{2}(?::\d{2}(?:[.,]\d{1,9})?)?)?(?:Z|[+-]\d{2}(?::?\d{2})?)?)?(?:\|\|.*)?$/;

/**
 * Whether a value is a date or a time written as ISO 8601 text.
 *
 * @param value - The value.
 * @returns `true` for such as `2026-10-05T14:47:01Z`, `false` for a number or any other text.
 */
export function isoBound(value: unknown): boolean {
  return typeof value === 'string' && isoText.test(value);
}
