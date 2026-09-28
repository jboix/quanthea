/** A structured logger that writes one JSON object per line. */

/** Log levels, least severe first. */
export const logLevels = ['debug', 'info', 'warn', 'error'] as const;

/** A log level. */
export type LogLevel = (typeof logLevels)[number];

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
 * Creates a logger that drops lines below `minimum`.
 *
 * @param minimum - The least severe level that is written.
 * @param sinks - Where lines go. Defaults to standard output and standard error.
 * @returns The logger.
 */
export function createLogger(minimum: LogLevel, sinks: LoggerSinks = processSinks): Logger {
  const threshold = logLevels.indexOf(minimum);
  const write = (level: LogLevel, message: string, fields: LogFields = {}): void => {
    if (logLevels.indexOf(level) < threshold) return;
    const line = `${JSON.stringify({ time: new Date().toISOString(), level, message, ...fields })}\n`;
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
