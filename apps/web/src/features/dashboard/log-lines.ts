/**
 * The lines of a log view: for each row of its result, the time, the message from its columns, the
 * level and its tone, and every column of the row as text, for a line opened.
 */
import {
  createFormatter,
  datasetOfFrames,
  type LogView,
  levelTone,
  maxLogLines,
  type QueryOutcome,
  type Tone,
} from '@quanthea/shared';

/** One column of a line opened. */
export interface LogField {
  /** The column's name. */
  readonly name: string;
  /** Its value, as text. */
  readonly text: string;
}

/** One line of a log. */
export interface LogLine {
  /** The place of its row in the result. */
  readonly key: string;
  /** When it was written, in the dashboard's time zone. */
  readonly time: string;
  /** Its level, as the result writes it, when the view names a column of levels. */
  readonly level?: string;
  /** The tone of its level, for an error or a warning. */
  readonly tone?: Tone;
  /** Its message: the message columns, one after the other. */
  readonly message: string;
  /** Every column of its row. */
  readonly fields: readonly LogField[];
}

/** The lines of a log, and whether the result held more than it shows. */
export interface LogLines {
  /** The lines, in the result's order. */
  readonly lines: readonly LogLine[];
  /** Whether lines were left out, past the view's limit. */
  readonly truncated: boolean;
}

/**
 * A value as a line shows it.
 *
 * @param value - The value.
 * @returns Its text; empty for no value.
 */
function textOf(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

/** Where a log's columns sit in its result, and how it writes a time. */
interface LogColumns {
  /** Every column's name. */
  readonly names: readonly string[];
  /** The place of the time column, or -1. */
  readonly time: number;
  /** The place of the level column, or -1. */
  readonly level: number;
  /** The places of the message columns found. */
  readonly messages: readonly number[];
  /** Writes a time in the dashboard's time zone. */
  readonly formatTime: (value: unknown) => string;
}

/**
 * One line of a log.
 *
 * @param row - The row.
 * @param place - Its place in the result.
 * @param columns - Where the log's columns sit.
 * @returns The line.
 */
function lineOf(row: readonly unknown[], place: number, columns: LogColumns): LogLine {
  const level = columns.level < 0 ? undefined : textOf(row[columns.level]);
  const tone = levelTone(level);
  const message = columns.messages
    .map((index) => textOf(row[index]))
    .filter(Boolean)
    .join('  ');
  const fields = columns.names.map((name, index) => ({ name, text: textOf(row[index]) }));
  const time = columns.time < 0 ? '' : columns.formatTime(row[columns.time]);
  const leveled = { ...(level ? { level } : {}), ...(tone ? { tone } : {}) };
  return { key: String(place), time, ...leveled, message, fields };
}

/**
 * The lines of a log view.
 *
 * @param view - The log view.
 * @param queries - The outcomes of the panel's queries.
 * @param timeZone - The IANA time zone, or the browser's.
 * @returns The lines, at most the view's limit.
 */
export function logLines(
  view: LogView,
  queries: readonly QueryOutcome[],
  timeZone: string | undefined,
): LogLines {
  const frames = queries.find((query) => query.refId === view.ref)?.frames ?? [];
  const dataset = datasetOfFrames(frames);
  const names = dataset.dimensions.map((column) => column.name);
  const at = (name: string | undefined) => (name === undefined ? -1 : names.indexOf(name));
  const columns: LogColumns = {
    names,
    time: at(view.time),
    level: at(view.level),
    messages: view.message.map(at).filter((index) => index >= 0),
    formatTime: createFormatter({ $fmt: 'datetime' }, { timeZone }),
  };
  const limit = view.limit ?? maxLogLines;
  const lines = dataset.source.slice(0, limit).map((row, place) => lineOf(row, place, columns));
  return { lines, truncated: dataset.source.length > limit };
}
