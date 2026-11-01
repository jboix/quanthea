import type { LogView as LogViewSpec, QueryOutcome } from '@quanthea/shared';
import { useMemo } from 'react';
import styles from './log.module.css';
import { type LogLine, logLines } from './log-lines.ts';
import panelStyles from './panels.module.css';
import { toneStyle } from './tone.ts';

/** Props of {@link LogView}. */
interface LogViewProps {
  /** The log view. */
  readonly view: LogViewSpec;
  /** The outcome of each query of the panel. */
  readonly queries: readonly QueryOutcome[];
  /** The IANA time zone, or the browser's. */
  readonly timeZone: string | undefined;
}

/**
 * One line: its time, its level in its tone, and its message. It opens to every column of its
 * row.
 *
 * @param props - The line.
 * @param props.line - The line.
 * @returns The line.
 */
function LogEntry({ line }: { readonly line: LogLine }) {
  return (
    <details className={styles.line}>
      <summary className={styles.summary}>
        <span className={styles.time}>{line.time}</span>
        {line.level !== undefined && (
          <span
            className={styles.level}
            style={toneStyle(line.tone)}
            data-toned={line.tone !== undefined}
          >
            {line.level}
          </span>
        )}
        <span className={styles.message}>{line.message}</span>
      </summary>
      <dl className={styles.fields}>
        {line.fields.map((field) => (
          <div key={field.name} className={styles.field}>
            <dt>{field.name}</dt>
            <dd>{field.text}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

/**
 * A log: a line for each row, newest first when the query sorts so, each opening to every column
 * of its row.
 *
 * @param props - The view, the outcomes and the time zone.
 * @returns The log.
 */
export function LogView({ view, queries, timeZone }: LogViewProps) {
  const { lines, truncated } = useMemo(
    () => logLines(view, queries, timeZone),
    [view, queries, timeZone],
  );
  return (
    <div className={styles.log}>
      {lines.map((line) => (
        <LogEntry key={line.key} line={line} />
      ))}
      {truncated && <p className={panelStyles.note}>Showing the first {lines.length} lines.</p>}
    </div>
  );
}
