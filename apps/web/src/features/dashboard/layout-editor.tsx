/**
 * Arranging the version shown, on the dashboard screen: the state of the edit, its bar with Save
 * and Cancel, and the question asked before leaving with changes unsaved.
 */
import type { DashboardLayout, LayoutRevision } from '@quanthea/shared';
import { useEffect, useState } from 'react';
import { type SubmitTarget, useBlocker, useFetcher } from 'react-router';
import { Button } from '../../ui/button.tsx';
import { Dialog } from '../../ui/dialog.tsx';
import type { DashboardData, Loaded } from './data.ts';
import type { LayoutIntent } from './layout-data.ts';
import { layoutChanged, startingLayout } from './layout-edit.ts';
import styles from './layout-editor.module.css';

/** An edit of the layout under way. */
export interface LayoutEditor {
  /** The layout as edited, or `null` when nothing is being arranged. */
  readonly draft: DashboardLayout | null;
  /** Whether the edit changed anything. */
  readonly dirty: boolean;
  /** Starts arranging. */
  readonly start: () => void;
  /** Changes the layout being edited. */
  readonly change: (layout: DashboardLayout) => void;
  /** Saves the edit as a new revision. */
  readonly save: () => void;
  /** Drops the edit. */
  readonly cancel: () => void;
  /** Whether a save is on its way. */
  readonly saving: boolean;
  /** Why the last save was refused, if it was. */
  readonly refusal: string | null;
}

/**
 * Sends a layout to be saved as the version's next revision.
 *
 * @param submit - The fetcher's submit.
 * @param version - The version shown, with the revision it is shown with.
 * @param layout - The layout.
 */
function submitLayout(
  submit: ReturnType<typeof useFetcher>['submit'],
  version: DashboardData['version'],
  layout: DashboardLayout,
): void {
  const basedOn = version.layout?.revision ?? null;
  const intent: LayoutIntent = { intent: 'layout', version: version.version, layout, basedOn };
  void submit(intent as unknown as SubmitTarget, { method: 'post', encType: 'application/json' });
}

/**
 * The state of an edit of the version shown. A save that succeeds ends the edit, and the screen
 * reloads with the new layout.
 *
 * @param data - The dashboard and the version shown.
 * @returns The edit.
 */
export function useLayoutEditor(data: DashboardData): LayoutEditor {
  const { version } = data;
  const shown = version.layout?.layout;
  const [draft, setDraft] = useState<DashboardLayout | null>(null);
  const fetcher = useFetcher<Loaded<LayoutRevision>>();
  const outcome = fetcher.state === 'idle' ? fetcher.data : undefined;
  useEffect(() => {
    if (outcome?.ok) setDraft(null);
  }, [outcome]);
  const base = startingLayout(version.spec, shown);
  const save = () => {
    if (draft) submitLayout(fetcher.submit, version, draft);
  };
  return {
    draft,
    dirty: draft !== null && layoutChanged(base, draft),
    start: () => setDraft(base),
    change: setDraft,
    save,
    cancel: () => setDraft(null),
    saving: fetcher.state !== 'idle',
    refusal: outcome && !outcome.ok && draft ? outcome.message : null,
  };
}

/**
 * The bar shown while arranging, in place of the header's actions.
 *
 * @param props - The edit.
 * @param props.editor - The edit.
 * @returns The bar.
 */
export function LayoutBar({ editor }: { readonly editor: LayoutEditor }) {
  return (
    <div className={styles.bar}>
      <p className={styles.hint}>
        Drag a panel to move it, drag its corner to resize it. Only how it is shown changes.
      </p>
      {editor.refusal && (
        <p className={styles.refusal} role="alert">
          {editor.refusal}
        </p>
      )}
      <Button onClick={editor.cancel} disabled={editor.saving}>
        Cancel
      </Button>
      <Button variant="primary" onClick={editor.save} disabled={!editor.dirty || editor.saving}>
        {editor.saving ? 'Saving…' : 'Save layout'}
      </Button>
    </div>
  );
}

/**
 * Asks before leaving the dashboard with an unsaved layout: in the app, and when the tab closes or
 * reloads. Changing the variables or the time range stays on the page and asks nothing.
 *
 * @param props - Whether there are unsaved changes.
 * @param props.dirty - Whether there are.
 * @returns The question, while a navigation waits for an answer.
 */
export function LeaveGuard({ dirty }: { readonly dirty: boolean }) {
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && currentLocation.pathname !== nextLocation.pathname,
  );
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const blocked = blocker.state === 'blocked';
  return (
    <Dialog title="Leave without saving?" open={blocked} onClose={() => blocker.reset?.()}>
      <p>The layout you arranged is not saved. Leaving drops it.</p>
      <div className={styles.choices}>
        <Button onClick={() => blocker.reset?.()}>Stay</Button>
        <Button variant="danger" onClick={() => blocker.proceed?.()}>
          Leave
        </Button>
      </div>
    </Dialog>
  );
}
