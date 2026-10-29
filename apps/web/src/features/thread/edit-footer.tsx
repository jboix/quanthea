/**
 * The foot of the inspector's edit tabs: Run, which test-runs the edit through the server, Save,
 * and what the last test run or refusal said.
 */
import type { PanelTestOutcome } from '@quanthea/shared';
import { Button } from '../../ui/button.tsx';
import type { PanelIssue } from './panel-edit-data.ts';
import styles from './panel-editor.module.css';
import type { PanelEditState } from './use-panel-edit.ts';

/**
 * The problems, each at its path inside the panel.
 *
 * @param props - The problems.
 * @param props.issues - The problems.
 * @returns The list, or nothing.
 */
function Issues({ issues }: { readonly issues: readonly PanelIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <ul className={styles.issues}>
      {issues.map((issue) => (
        <li key={`${issue.path}:${issue.message}`}>
          {issue.path && <code>{issue.path}</code>} {issue.message}
        </li>
      ))}
    </ul>
  );
}

/**
 * What each query returned on the test run.
 *
 * @param props - The test run.
 * @param props.outcome - The test run.
 * @returns The lines.
 */
function Ran({ outcome }: { readonly outcome: PanelTestOutcome }) {
  return (
    <ul className={styles.ran}>
      {outcome.queries.map((query) => (
        <li key={query.refId} data-failed={query.error !== undefined}>
          Query {query.refId}: {query.error ?? `${query.rows} rows`}
        </li>
      ))}
      {outcome.ok && <li>The panel works. Save adds a new version.</li>}
    </ul>
  );
}

/**
 * Run, Save, and the outcome of the last of them.
 *
 * @param props - The edit.
 * @param props.edit - The edit.
 * @returns The footer.
 */
export function EditFooter({ edit }: { readonly edit: PanelEditState }) {
  const { tested, refusal } = edit;
  return (
    <footer className={styles.footer}>
      <div className={styles.actions}>
        <Button size="small" disabled={!edit.changed || edit.busy} onClick={edit.run}>
          Run
        </Button>
        <Button size="small" variant="primary" disabled={!edit.savable} onClick={edit.save}>
          Save
        </Button>
        {edit.changed && !edit.savable && !edit.busy && (
          <span className={styles.note}>Run the changed query before saving.</span>
        )}
      </div>
      {refusal && <p className={styles.refusal}>{refusal.message}</p>}
      {refusal && <Issues issues={refusal.issues} />}
      {tested && <Issues issues={tested.issues} />}
      {tested && <Ran outcome={tested} />}
    </footer>
  );
}
