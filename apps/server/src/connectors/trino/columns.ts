/** Maps Trino column types to frame fields, and JSON values to frame values. */
import type { FieldType } from '@quanthea/shared';

/** Numeric types. Decimals arrive as strings, doubles as numbers or `NaN`, `Infinity`. */
const numberType = /^(?:tinyint|smallint|integer|bigint|real|double|decimal)(?:\(.*\))?$/;

/** Date and timestamp types, with or without a precision and a time zone. */
const timeType = /^(?:date|timestamp)(?:\(\d+\))?(?: with time zone)?$/;

/** A Trino date or timestamp as text: `2026-09-27`, or `2026-09-27 12:02:00.000[ zone]`. */
const timeText = /^(\d{4}-\d{2}-\d{2})(?: (\d{2}:\d{2}:\d{2})(\.\d+)?)?(?: (.+))?$/;

/** A zone written as an offset, such as `+02:00`. */
const offsetZone = /^([+-])(\d{2}):(\d{2})$/;

/**
 * The frame type of a column.
 *
 * @param type - The Trino type, such as `timestamp(3) with time zone`.
 * @returns `number`, `time`, `boolean`, or `string` for every other type.
 */
export function fieldTypeOf(type: string): FieldType {
  const name = type.trim().toLowerCase();
  if (numberType.test(name)) return 'number';
  if (timeType.test(name)) return 'time';
  return name === 'boolean' ? 'boolean' : 'string';
}

/**
 * How far a time zone is ahead of UTC at an instant.
 *
 * @param zone - An IANA zone, such as `Europe/Zurich`.
 * @param instant - Epoch milliseconds.
 * @returns The offset in milliseconds, `NaN` for an unknown zone.
 */
function zoneOffset(zone: string, instant: number): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    }).formatToParts(new Date(instant));
    const part = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
    const wall = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'));
    return wall + part('minute') * 60_000 + part('second') * 1000 - (instant - (instant % 1000));
  } catch {
    return Number.NaN;
  }
}

/**
 * The UTC instant of a wall-clock time in a zone: UTC, an offset or an IANA name.
 *
 * @param wall - The wall-clock time, as if it were UTC, in epoch milliseconds.
 * @param zone - The zone, or `undefined` for a time without one, which the UTC session reads as UTC.
 * @returns Epoch milliseconds, `NaN` for an unknown zone.
 */
function inZone(wall: number, zone: string | undefined): number {
  if (zone === undefined || zone === 'UTC' || zone === 'Z') return wall;
  const offset = offsetZone.exec(zone);
  if (offset) {
    const minutes = Number(offset[2]) * 60 + Number(offset[3]);
    return wall - (offset[1] === '-' ? -minutes : minutes) * 60_000;
  }
  const guess = wall - zoneOffset(zone, wall);
  return wall - zoneOffset(zone, guess);
}

/**
 * Reads a Trino date or timestamp.
 *
 * @param text - Such as `2026-09-27 12:02:00.000 Europe/Zurich`.
 * @returns Epoch milliseconds, `NaN` when the text is not a time.
 */
export function parseTime(text: string): number {
  const match = timeText.exec(text);
  if (!match) return Number.NaN;
  const [, date, time = '00:00:00', fraction = '', zone] = match;
  const wall = Date.parse(`${date}T${time}${fraction.slice(0, 4)}Z`);
  return inZone(wall, zone);
}

/**
 * Converts a JSON value, as Trino writes it, to the frame value of its field type.
 *
 * @param type - The field type, from {@link fieldTypeOf}.
 * @param value - The JSON value.
 * @returns A finite number, epoch milliseconds, a boolean, a string, or `null`.
 */
export function frameValue(type: FieldType, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (type === 'number') return finiteOrNull(Number(value));
  if (type === 'time') return finiteOrNull(parseTime(String(value)));
  if (type === 'boolean') return Boolean(value);
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/**
 * A number, or `null` for NaN and the infinities, which frames do not hold.
 *
 * @param value - The number.
 * @returns The number or `null`.
 */
function finiteOrNull(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}
