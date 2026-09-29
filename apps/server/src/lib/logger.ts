/**
 * A structured logger: readable text lines by default, or one JSON object per line for log
 * collectors.
 */

/** Log levels, least severe first. */
export const logLevels = ['debug', 'info', 'warn', 'error'] as const;

/** A log level. */
export type LogLevel = (typeof logLevels)[number];

/** How lines are written: `text` for people, `json` for log collectors. */
export const logFormats = ['text', 'json'] as const;

/** A log format. */
export type LogFormat = (typeof logFormats)[number];

/** Extra structured fields attached to a log line. */
type LogFields = Readonly<Record<string, unknown>>;

/** Writes one finished log line. */
type LogSink = (line: string) => void;

/** Writes log lines at or above the configured level. */
export interface Logger {
  /** Logs detail useful only while debugging. */
  debug(message: string, fields?: LogFields): void;
  /** Logs a normal event. */
  info(message: string, fields?: LogFields): void;
  /** Logs something an operator should look at. */
  warn(message: string, fields?: LogFields): void;
  /** Logs a failure. */
  error(message: string, fields?: LogFields): void;
}

/** Where each severity is written. Tests pass their own sinks to capture lines. */
interface LoggerSinks {
  /** Receives `debug` and `info` lines. */
  readonly stdout: LogSink;
  /** Receives `warn` and `error` lines. */
  readonly stderr: LogSink;
}

/** Writes to the process's standard output and standard error. */
const processSinks: LoggerSinks = {
  stdout: (line) => process.stdout.write(line),
  stderr: (line) => process.stderr.write(line),
};

/**
 * Turns an error into fields that serialize to JSON.
 *
 * @param error - Anything thrown.
 * @returns The name, message and stack of an `Error`, or the value as a string.
 */
export function errorFields(error: unknown): LogFields {
  if (!(error instanceof Error)) return { error: String(error) };
  return { error: { name: error.name, message: error.message, stack: error.stack } };
}

/**
 * A field value as text: plain when it reads unambiguously, quoted JSON otherwise.
 *
 * @param value - The value.
 * @returns Such as `200`, `/api/threads` or `"two words"`.
 */
function textValue(value: unknown): string {
  if (typeof value === 'string') return /^[^\s"=]+$/.test(value) ? value : JSON.stringify(value);
  return JSON.stringify(value) ?? String(value);
}

/**
 * The error of a text line: its stack on the lines below, or its text inline.
 *
 * @param error - The `error` field, as {@link errorFields} makes it.
 * @returns The text to append.
 */
function errorText(error: unknown): string {
  if (error === undefined) return '';
  const stack = (error as { stack?: unknown }).stack;
  return typeof stack === 'string' ? `\n${stack}` : ` error=${textValue(error)}`;
}

/**
 * One text line, such as `2026-09-29 14:03:12.345 INFO  request method=GET status=200`.
 *
 * @param time - When.
 * @param level - The level.
 * @param message - The message.
 * @param fields - The fields, written as `key=value`; an error's stack goes below.
 * @returns The line.
 */
function textLine(time: Date, level: LogLevel, message: string, fields: LogFields): string {
  const { error, ...rest } = fields;
  const stamp = time.toISOString().replace('T', ' ').slice(0, 23);
  const pairs = Object.entries(rest).map(([key, value]) => ` ${key}=${textValue(value)}`);
  return `${stamp} ${level.toUpperCase().padEnd(5)} ${message}${pairs.join('')}${errorText(error)}\n`;
}

/**
 * One JSON line.
 *
 * @param time - When.
 * @param level - The level.
 * @param message - The message.
 * @param fields - The fields.
 * @returns The line.
 */
function jsonLine(time: Date, level: LogLevel, message: string, fields: LogFields): string {
  return `${JSON.stringify({ time: time.toISOString(), level, message, ...fields })}\n`;
}

/**
 * Creates a logger that drops lines below `minimum`.
 *
 * @param minimum - The least severe level that is written.
 * @param sinks - Where lines go. Defaults to standard output and standard error.
 * @param format - How lines are written; readable text by default.
 * @returns The logger.
 */
export function createLogger(
  minimum: LogLevel,
  sinks: LoggerSinks = processSinks,
  format: LogFormat = 'text',
): Logger {
  const threshold = logLevels.indexOf(minimum);
  const lineOf = format === 'json' ? jsonLine : textLine;
  const write = (level: LogLevel, message: string, fields: LogFields = {}): void => {
    if (logLevels.indexOf(level) < threshold) return;
    const line = lineOf(new Date(), level, message, fields);
    const sink = level === 'warn' || level === 'error' ? sinks.stderr : sinks.stdout;
    sink(line);
  };
  return {
    debug: (message, fields) => write('debug', message, fields),
    info: (message, fields) => write('info', message, fields),
    warn: (message, fields) => write('warn', message, fields),
    error: (message, fields) => write('error', message, fields),
  };
}
