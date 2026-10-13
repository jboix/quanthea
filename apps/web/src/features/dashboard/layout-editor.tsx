/**
 * Arranging the version shown, on the screen of a dashboard or of a report's run: the state of the
 * edit, its frames over the panels, its bar with Save and Cancel, and the question asked before
 * leaving with changes unsaved.
 */
import type { DashboardLayout, LayoutRevision, PanelGrid, ShownLayout } from '@quanthea/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { type SubmitTarget, useBlocker, useFetcher } from 'react-router';
import { Button } from '../../ui/button.tsx';
import { Dialog } from '../../ui/dialog.tsx';
import { useMediaQuery } from '../../ui/use-media-query.ts';
import type { LayoutIntent } from './layout-data.ts';
import { layoutChanged, startingLayout } from './layout-edit.ts';
import styles from './layout-editor.module.css';
import { HiddenMenu, HistoryMenu } from './layout-menus.tsx';
import { LayoutOverlay } from './layout-overlay.tsx';
import type { Loaded } from './loaded.ts';

/** A version as it is arranged: the panels a layout names, and the layout it is shown with. */
export interface ArrangedVersion {
  /** The version. */
  readonly version: number;
  /** The panels on its grid, each with its title and the place its spec gives it. */
  readonly panels: readonly {
    readonly id: string;
    readonly title: string;
    readonly grid: PanelGrid;
  }[];
  /** The layout it is shown with, if one was saved. */
  readonly layout: ShownLayout | null;
}

/** Where an edit is sent and read from. */
export interface LayoutPaths {
  /** The route whose action saves and restores layouts; the screen's own when left out. */
  readonly action?: string | undefined;
  /** The resource route of the version's layout history. */
  readonly history: string;
}

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
  /** Drops the edit and restores an earlier revision, as a new one. */
  readonly restore: (revision: number) => void;
  /** Whether a save is on its way. */
  readonly saving: boolean;
  /** Why the last save was refused, if it was. */
  readonly refusal: string | null;
}

/** A change an edit sends: the layout to save, or the revision to restore. */
type LayoutChange = { readonly layout: DashboardLayout } | { readonly revision: number };

/**
 * The intent that saves a layout as the version's next revision, or restores an earlier revision.
 *
 * @param arranged - The version shown, with the revision it is shown with.
 * @param change - The layout, or the revision to restore.
 * @returns The intent.
 */
function intentOf(arranged: ArrangedVersion, change: LayoutChange): LayoutIntent {
  const basedOn = arranged.layout?.revision ?? null;
  const { version } = arranged;
  return 'layout' in change
    ? { intent: 'layout', version, layout: change.layout, basedOn }
    : { intent: 'restoreLayout', version, revision: change.revision, basedOn };
}

/**
 * The layout being edited, kept for one version: showing another version on the same screen
 * drops it, so an arrangement never lands on panels it was not made for.
 *
 * @param key - What is arranged, such as the path of its layout history.
 * @returns The layout being edited, or `null`, and its setter.
 */
function useDraft(key: string) {
  const [edit, setEdit] = useState<{ key: string; layout: DashboardLayout } | null>(null);
  const setDraft = useCallback(
    (layout: DashboardLayout | null) => setEdit(layout && { key, layout }),
    [key],
  );
  return [edit?.key === key ? edit.layout : null, setDraft] as const;
}

/**
 * The state of an edit of the version shown. A save that succeeds ends the edit, and the screen
 * reloads with the new layout.
 *
 * @param arranged - The version shown.
 * @param paths - Where the edit is sent, and the history that names the version arranged.
 * @returns The edit.
 */
function useLayoutEditor(arranged: ArrangedVersion, paths: LayoutPaths): LayoutEditor {
  const { action } = paths;
  const [draft, setDraft] = useDraft(paths.history);
  const fetcher = useFetcher<Loaded<LayoutRevision>>();
  const outcome = fetcher.state === 'idle' ? fetcher.data : undefined;
  useEffect(() => {
    if (outcome?.ok) setDraft(null);
  }, [outcome, setDraft]);
  const base = startingLayout(arranged, arranged.layout?.layout);
  const send = (change: LayoutChange) =>
    void fetcher.submit(intentOf(arranged, change) as unknown as SubmitTarget, {
      method: 'post',
      encType: 'application/json',
      ...(action === undefined ? {} : { action }),
    });
  return {
    draft,
    dirty: draft !== null && layoutChanged(base, draft),
    start: () => setDraft(base),
    change: setDraft,
    save: () => draft && send({ layout: draft }),
    cancel: () => setDraft(null),
    restore: (revision) => send({ revision }),
    saving: fetcher.state !== 'idle',
    refusal: outcome && !outcome.ok && draft ? outcome.message : null,
  };
}

/** Wide enough to arrange panels: below it the grid is one column. */
const wideScreen = '(min-width: 901px)';

/**
 * A version as people see it or as it is being arranged: the layout to draw it through, the edit
 * with its bar and its frames, and the way into the edit for those who may arrange it, on a
 * screen wide enough for the grid's twelve columns.
 *
 * @param arranged - The version shown.
 * @param allowed - Whether the person may arrange this version.
 * @param paths - Where the edit is sent, and where its history loads from.
 * @returns The layout shown, the edit, its bar, notes and frames while it lasts, and Edit
 *   layout's callback if offered.
 */
export function useArrangement(arranged: ArrangedVersion, allowed: boolean, paths: LayoutPaths) {
  const editor = useLayoutEditor(arranged, paths);
  const wide = useMediaQuery(wideScreen);
  const titles = useMemo(
    () => new Map(arranged.panels.map((panel) => [panel.id, panel.title])),
    [arranged.panels],
  );
  const editing = editor.draft !== null;
  return {
    editor,
    layout: editor.draft ?? arranged.layout?.layout,
    bar: editing && <LayoutBar editor={editor} titles={titles} historyPath={paths.history} />,
    notes: editing && <LayoutNotes editor={editor} />,
    overlay: editor.draft && (
      <LayoutOverlay layout={editor.draft} titles={titles} onChange={editor.change} />
    ),
    onArrange: allowed && wide ? editor.start : undefined,
  };
}

/** Props of {@link LayoutBar}. */
interface LayoutBarProps {
  /** The edit. */
  readonly editor: LayoutEditor;
  /** Each panel's title, by id. */
  readonly titles: ReadonlyMap<string, string>;
  /** The resource route of the version's layout history. */
  readonly historyPath: string;
}

/**
 * The lines shown under the title while arranging: how to arrange, and why the last save was
 * refused. They wrap there, so the header's actions hold only controls.
 *
 * @param props - The edit.
 * @param props.editor - The edit.
 * @returns The lines.
 */
function LayoutNotes({ editor }: { readonly editor: LayoutEditor }) {
  return (
    <>
      <p className={styles.hint}>
        Drag a panel to move it, its corner to resize it. Only how it is shown changes.
      </p>
      {editor.refusal && (
        <p className={styles.refusal} role="alert">
          {editor.refusal}
        </p>
      )}
    </>
  );
}

/**
 * The bar shown while arranging, in place of the header's actions: the hidden panels, the
 * history, Cancel and Save layout.
 *
 * @param props - The edit, the panels' titles and where the history loads from.
 * @returns The bar.
 */
function LayoutBar({ editor, titles, historyPath }: LayoutBarProps) {
  return (
    <div className={styles.bar}>
      {editor.draft && (
        <HiddenMenu layout={editor.draft} titles={titles} onChange={editor.change} />
      )}
      <HistoryMenu path={historyPath} onRestore={editor.restore} />
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
 * Asks before leaving the page with an unsaved layout: in the app, and when the tab closes or
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
