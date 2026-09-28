import styles from './conversation.module.css';
import { describeCall, shapeOf, type ToolPart, toolName } from './messages.ts';

/**
 * The explore calls of a turn, grouped: "Explored · 3 steps", one line per call.
 *
 * @param props - The calls.
 * @param props.parts - The explore tool parts, in order.
 * @returns The log.
 */
export function ExploreLog({ parts }: { readonly parts: readonly ToolPart[] }) {
  return (
    <section className={styles.log} aria-label="Explored">
      <h4 className={styles.logTitle}>
        Explored · {parts.length} {parts.length === 1 ? 'step' : 'steps'}
      </h4>
      <ul className={styles.logLines}>
        {parts.map((part) => {
          const { call, result, failed } = describeCall(part);
          return (
            <li key={part.toolCallId} data-failed={failed} data-running={result === '…'}>
              <span className={styles.logMark}>{failed ? '✗' : result === '…' ? '·' : '✓'}</span>
              {call}: {result}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** A panel's test run, as the write tool reports it. */
interface PanelReport {
  /** The panel. */
  readonly panelId: string;
  /** Each query's result. */
  readonly queries: readonly {
    readonly refId: string;
    readonly ok: boolean;
    readonly error?: string;
    readonly frames?: readonly { rowCount?: number }[];
  }[];
}

/** What a write tool returned. */
interface WriteOutput {
  /** Whether the version was saved. */
  readonly ok?: boolean;
  /** The new version. */
  readonly version?: number;
  /** Why not. */
  readonly error?: string;
  /** The spec's issues. */
  readonly issues?: readonly { path: string; message: string }[];
  /** The panels' test runs. */
  readonly panels?: readonly PanelReport[];
}

/**
 * The line of one panel's test run.
 *
 * @param panel - The panel's report.
 * @returns Such as `error-rate: 1 row`, or its error.
 */
function panelLine(panel: PanelReport): { text: string; failed: boolean } {
  const failure = panel.queries.find((query) => !query.ok);
  if (failure) return { text: `${panel.panelId}: ${failure.error ?? 'failed'}`, failed: true };
  const frames = panel.queries.flatMap((query) => query.frames ?? []);
  return {
    text: `${panel.panelId}: ${shapeOf(frames.length > 0 ? frames : undefined)}`,
    failed: false,
  };
}

/**
 * The heading of a write.
 *
 * @param part - The write tool part.
 * @param output - What it returned.
 * @param running - Whether it is still running.
 * @param tested - How many queries passed, of how many, such as `6 of 6`.
 * @returns The heading.
 */
function buildTitle(part: ToolPart, output: WriteOutput, running: boolean, tested: string): string {
  if (running) return `${toolName(part) === 'patch_panel' ? 'Changing a panel' : 'Building'}…`;
  return output.ok ? `Built v${output.version} · ${tested} queries test-run` : 'Not saved';
}

/**
 * One write of a version: "Built · 6 of 6 queries test-run", or what to fix.
 *
 * @param props - The write tool part.
 * @param props.part - The part.
 * @returns The log.
 */
export function BuildLog({ part }: { readonly part: ToolPart }) {
  const output = (part.output ?? {}) as WriteOutput;
  const panels = output.panels ?? [];
  const queries = panels.flatMap((panel) => panel.queries);
  const passed = queries.filter((query) => query.ok).length;
  const running = part.state !== 'output-available' && part.state !== 'output-error';
  const title = buildTitle(part, output, running, `${passed} of ${queries.length}`);
  return (
    <section className={styles.log} aria-label="Built">
      <h4 className={styles.logTitle} data-failed={!running && !output.ok}>
        {title}
      </h4>
      <ul className={styles.logLines}>
        {panels.map((panel) => {
          const line = panelLine(panel);
          return (
            <li key={panel.panelId} data-failed={line.failed}>
              <span className={styles.logMark}>{line.failed ? '✗' : '✓'}</span>
              {line.text}
            </li>
          );
        })}
        {(output.issues ?? []).map((issue) => (
          <li key={issue.path} data-failed="true">
            <span className={styles.logMark}>✗</span>
            {issue.path}: {issue.message}
          </li>
        ))}
        {part.state === 'output-error' && <li data-failed="true">{part.errorText}</li>}
      </ul>
    </section>
  );
}
