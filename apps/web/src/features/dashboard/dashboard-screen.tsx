import { applyLayout } from '@quanthea/shared';
import { useEffect, useMemo, useState } from 'react';
import { Link, useLoaderData, useLocation } from 'react-router';
import { LockIcon } from '../../ui/icons.tsx';
import { Pill } from '../../ui/pill.tsx';
import { useMediaQuery } from '../../ui/use-media-query.ts';
import { marksOnVersion, type OpenAnswer } from './ask-marks.ts';
import { DashboardCanvas } from './canvas.tsx';
import styles from './dashboard.module.css';
import { AboutPopover } from './dashboard-about.tsx';
import { type AskAction, HeaderActions } from './dashboard-actions.tsx';
import type { DashboardData } from './data.ts';
import { LayoutBar, type LayoutEditor, LeaveGuard, useLayoutEditor } from './layout-editor.tsx';
import { LayoutOverlay } from './layout-overlay.tsx';
import { SidePanel, type SideTab } from './side-panel.tsx';
import { versionNote } from './version-note.ts';

/**
 * The top of the screen: where it sits, its title with what it is about, its version and whether
 * it is pinned, and its history, its thread and its link.
 *
 * @param props - The dashboard, the version shown, the way into the Ask tab, and the layout edit,
 *   whose bar takes the actions' place while it lasts.
 * @returns The header.
 */
function DashboardHeader(props: DashboardData & AskAction & { readonly editor: LayoutEditor }) {
  const { version, dashboard, editor, ...actions } = props;
  const shown = version.version === dashboard.pinnedVersion;
  const note = versionNote(version, dashboard.pinnedVersion);
  return (
    <header className={styles.header}>
      <div className={styles.headerText}>
        <nav aria-label="Breadcrumb" className={styles.crumbs}>
          <Link to="/library">Library</Link> /{' '}
          {dashboard.pinnedVersion === null ? 'not pinned' : 'pinned'}
        </nav>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>{version.spec.title}</h1>
          <AboutPopover {...props} />
          <Pill mono tone={version.pinnedAt === null ? 'draft' : 'neutral'}>
            {shown && <LockIcon />}
            {`v${version.version} · ${version.pinnedAt === null ? 'draft' : note}`}
          </Pill>
        </div>
      </div>
      {editor.draft ? (
        <LayoutBar editor={editor} />
      ) : (
        <HeaderActions {...actions} version={version} dashboard={dashboard} />
      )}
    </header>
  );
}

/**
 * Scrolls to the panel a link names in its hash, such as `#panel-errors`, as the library's
 * matching panels do.
 */
function useScrollToPanel(): void {
  const { hash } = useLocation();
  useEffect(() => {
    if (hash === '') return;
    document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView({ block: 'center' });
  }, [hash]);
}

/** Wide enough to arrange panels: below it the grid is one column. */
const wideScreen = '(min-width: 901px)';

/**
 * The version as people see it, or as it is being arranged: its spec through the layout, the edit
 * and its frames, and the way into the edit for those who may arrange the version shown.
 *
 * @param data - The dashboard and the version shown.
 * @returns What the canvas shows, the edit, its overlay, and Edit layout's callback if offered.
 */
function useArrangedView(data: DashboardData) {
  const { dashboard, version } = data;
  const editor = useLayoutEditor(data);
  const wide = useMediaQuery(wideScreen);
  const layout = editor.draft ?? version.layout?.layout;
  const spec = useMemo(() => applyLayout(version.spec, layout).spec, [version.spec, layout]);
  const titles = useMemo(
    () => new Map(version.spec.panels.map((panel) => [panel.id, panel.title])),
    [version.spec],
  );
  const arrangeable = dashboard.canChange && dashboard.pinnedVersion === version.version && wide;
  const overlay = editor.draft && (
    <LayoutOverlay layout={editor.draft} titles={titles} onChange={editor.change} />
  );
  const shown = { dashboardId: dashboard.id, version: version.version, spec };
  return { shown, editor, overlay, onArrange: arrangeable ? editor.start : undefined };
}

/**
 * The side panel and the answer open in it. Questions are about what everyone may see, a pinned
 * version of a pinned dashboard, and the panel closes while the layout is arranged.
 *
 * @param data - The dashboard and the version shown.
 * @param arranging - Whether the layout is being arranged.
 * @returns The tab shown, whether questions can be asked, the marks of the open answer, and the
 *   setters.
 */
function useAsk(data: DashboardData, arranging: boolean) {
  const { dashboard, version } = data;
  const [side, setSide] = useState<SideTab | null>(null);
  const [open, setOpen] = useState<OpenAnswer | undefined>();
  const askable = dashboard.pinnedVersion !== null && version.pinnedAt !== null;
  const shownSide = askable && !arranging ? side : null;
  const marks = shownSide === 'ask' ? marksOnVersion(open, version.version) : undefined;
  const onAsk = askable ? () => setSide('ask') : undefined;
  return { shownSide, askable, marks, onAsk, setSide, setOpen };
}

/**
 * A dashboard: its variables, and its panels running saved queries with no model involved. On a
 * pinned version, Ask about this opens the side panel's Ask tab, beside the header and the panels;
 * the answer that marks the charts there badges the panels it cites, in the page only.
 *
 * @returns The screen.
 */
export function DashboardScreen() {
  useScrollToPanel();
  const loaded = useLoaderData() as DashboardData;
  const view = useArrangedView(loaded);
  const ask = useAsk(loaded, view.editor.draft !== null);
  const { shownSide, askable } = ask;
  const header = { onAsk: ask.onAsk, asking: shownSide !== null, onArrange: view.onArrange };
  return (
    <div className={styles.screen}>
      <div className={styles.content}>
        <DashboardHeader {...loaded} {...header} editor={view.editor} />
        <div className={styles.main}>
          <DashboardCanvas
            refreshable
            withAlerts
            {...view.shown}
            answerMarks={ask.marks}
            explainable={askable}
            overlay={view.overlay}
          />
        </div>
      </div>
      <LeaveGuard dirty={view.editor.dirty} />
      {shownSide && (
        <SidePanel
          {...loaded}
          tab={shownSide}
          onTab={ask.setSide}
          onClose={() => ask.setSide(null)}
          onOpenAnswer={ask.setOpen}
        />
      )}
    </div>
  );
}
