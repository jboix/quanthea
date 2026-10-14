import { applyLayout } from '@quanthea/shared';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { Link, useLoaderData, useLocation, useNavigate, useSearchParams } from 'react-router';
import { LockIcon } from '../../ui/icons.tsx';
import { Pill } from '../../ui/pill.tsx';
import { TitleHeader } from '../../ui/title-header.tsx';
import { marksOnVersion, type OpenAnswer } from './ask-marks.ts';
import { DashboardCanvas } from './canvas.tsx';
import styles from './dashboard.module.css';
import { AboutPopover } from './dashboard-about.tsx';
import { type AskAction, HeaderActions } from './dashboard-actions.tsx';
import type { DashboardData } from './data.ts';
import { LeaveGuard, useArrangement } from './layout-editor.tsx';
import { SidePanel, type SideTab } from './side-panel.tsx';
import { useCanEdit } from './use-can-edit.ts';
import { versionNote } from './version-note.ts';
import { choicesFromSearch } from './view-state.ts';

/** What the layout edit puts in the header while it lasts. */
interface LayoutEditParts {
  /** Its bar, which takes the actions' place. */
  readonly bar: ReactNode;
  /** Its hint and the reason of a refused save, shown under the title. */
  readonly notes: ReactNode;
}

/**
 * The top of the screen: where it sits, its title with what it is about, its version and whether
 * it is pinned, and its history, its thread and its link.
 *
 * @param props - The dashboard, the version shown, the way into the Ask tab, and the layout
 *   edit's bar, which takes the actions' place while the edit lasts, with its notes under the
 *   title.
 * @returns The header.
 */
function DashboardHeader(props: DashboardData & AskAction & LayoutEditParts) {
  const { version, dashboard, bar, notes, ...actions } = props;
  const shown = version.version === dashboard.pinnedVersion;
  const note = versionNote(version, dashboard.pinnedVersion);
  return (
    <TitleHeader
      className={styles.header}
      level={1}
      size="screen"
      align="end"
      title={version.spec.title}
      eyebrow={
        <nav aria-label="Breadcrumb">
          <Link to="/library">Library</Link> /{' '}
          {dashboard.pinnedVersion === null ? 'not pinned' : 'pinned'}
        </nav>
      }
      badges={
        <>
          <AboutPopover {...props} />
          <Pill mono tone={version.pinnedAt === null ? 'draft' : 'neutral'}>
            {shown && <LockIcon />}
            {`v${version.version} · ${version.pinnedAt === null ? 'draft' : note}`}
          </Pill>
        </>
      }
      below={notes}
      actions={bar || <HeaderActions {...actions} version={version} dashboard={dashboard} />}
    />
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

/**
 * The version as people see it, or as it is being arranged: its spec through the layout, the edit
 * and its frames, and the way into the edit for those who may arrange the version shown.
 *
 * @param data - The dashboard and the version shown.
 * @returns What the canvas shows, the edit with its bar and overlay, and Edit layout's callback
 *   if offered.
 */
function useArrangedView(data: DashboardData) {
  const { dashboard, version } = data;
  const [search] = useSearchParams();
  const arranged = useMemo(() => {
    const { panels, variables } = version.spec;
    const values = choicesFromSearch(search, version.spec).variables;
    return { version: version.version, panels, layout: version.layout, variables, values };
  }, [version, search]);
  const allowed = dashboard.canChange && dashboard.pinnedVersion === version.version;
  const history = `/d/${dashboard.id}/v/${version.version}/layouts`;
  const { layout, ...edit } = useArrangement(arranged, allowed, { history });
  const spec = useMemo(() => applyLayout(version.spec, layout).spec, [version.spec, layout]);
  return { ...edit, shown: { dashboardId: dashboard.id, version: version.version, spec } };
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
 * What picking a panel's title does on a dashboard: for someone who may change it, open the
 * dashboard's thread with that panel mentioned, so the next turn is about it.
 *
 * @param data - The dashboard and the version shown.
 * @param arranging - Whether the layout is being arranged, when titles do nothing.
 * @returns The callback, or nothing when titles are not links.
 */
function usePanelChange(data: DashboardData, arranging: boolean) {
  const canEdit = useCanEdit();
  const navigate = useNavigate();
  const { threadId } = data.dashboard;
  if (!canEdit || threadId === null || arranging) return undefined;
  return (panelId: string) =>
    navigate(`/threads/${threadId}?mention=${encodeURIComponent(panelId)}`);
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
        <DashboardHeader {...loaded} {...header} bar={view.bar} notes={view.notes} />
        <div className={styles.main}>
          <DashboardCanvas
            refreshable
            withAlerts
            {...view.shown}
            answerMarks={ask.marks}
            explainable={askable}
            overlay={view.overlay}
            onSelectPanel={usePanelChange(loaded, view.editor.draft !== null)}
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
