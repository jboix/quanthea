import type { Plan, ThreadState } from '@quanthea/shared';
import type { CSSProperties } from 'react';
import { Button } from '../../ui/button.tsx';
import { Pill } from '../../ui/pill.tsx';
import { DashboardCanvas, type PanelPlanMark } from '../dashboard/index.ts';
import type { ThreadData } from './data.ts';
import styles from './draft-pane.module.css';
import { Inspector } from './inspector.tsx';
import {
  type ChangeRow,
  changeRows,
  draftPanelsOf,
  isChangePlan,
  panelMarks,
} from './plan-changes.ts';

/** Props of {@link DraftPane}. */
export interface DraftPaneProps {
  /** The thread, its dashboard and the version shown. */
  readonly data: ThreadData;
  /** The latest plan, for the skeleton before the first version. */
  readonly plan: Plan | undefined;
  /** Whether the agent is working. */
  readonly running: boolean;
  /** Whether the latest answer stopped with panels that still fail. */
  readonly stopped: boolean;
  /** The panel the inspector shows. */
  readonly selectedPanelId: string | undefined;
  /** Picks a panel, or closes the inspector with `undefined`. */
  readonly onSelectPanel: (panelId: string | undefined) => void;
  /** Panels the latest message mentions. */
  readonly markedPanelIds: readonly string[];
  /** Shows a version, or the latest with `undefined`. */
  readonly onShowVersion: (version: number | undefined) => void;
  /** Makes the version shown the one the library shows. */
  readonly onPin: (version: number) => void;
  /** Takes the dashboard out of the library. */
  readonly onUnpin: () => void;
  /** Whether a decision is on its way. */
  readonly busy: boolean;
}

/** The skeleton size of each kind of planned panel, in grid columns and rows. */
const skeletonSizes: Readonly<Record<string, { w: number; h: number }>> = {
  stat: { w: 4, h: 3 },
  line: { w: 12, h: 7 },
  table: { w: 6, h: 7 },
};

/**
 * The planned panels as dashed boxes, while the plan waits for approval.
 *
 * @param props - The plan.
 * @param props.plan - The plan.
 * @returns The skeleton grid.
 */
function PlanSkeleton({ plan }: { readonly plan: Plan }) {
  return (
    <div className={styles.skeleton}>
      {plan.panels.map((panel) => {
        const size = skeletonSizes[panel.kind] ?? { w: 6, h: 7 };
        const place = { gridColumn: `span ${size.w}`, gridRow: `span ${size.h}` } as CSSProperties;
        return (
          <div key={`${panel.kind}:${panel.title}`} className={styles.ghost} style={place}>
            {panel.title}
          </div>
        );
      })}
    </div>
  );
}

/**
 * The status pill of the pane.
 *
 * @param state - The thread state.
 * @param running - Whether the agent is working.
 * @param stopped - Whether the latest answer stopped with panels that still fail.
 * @param shown - The version shown, if any.
 * @param latest - The latest version, if any.
 * @returns The pill's tone and words.
 */
function statusOf(
  state: ThreadState,
  running: boolean,
  stopped: boolean,
  shown: number | undefined,
  latest: number | undefined,
) {
  if (shown !== undefined && shown !== latest)
    return { tone: 'neutral', text: `v${shown} · comparing` } as const;
  if (shown !== undefined) return { tone: 'draft', text: `v${shown} · draft` } as const;
  if (state === 'plan_pending')
    return { tone: 'neutral', text: 'waiting for plan approval' } as const;
  if (state === 'building' && !running && stopped)
    return { tone: 'danger', text: 'build stopped · try again' } as const;
  if (state === 'building') return { tone: 'neutral', text: 'building…' } as const;
  return { tone: 'neutral', text: running ? 'exploring…' : 'no dashboard yet' } as const;
}

/**
 * Pin for a version the library does not show, Unpin for the one it shows.
 *
 * @param props - The pane's props.
 * @param props.shown - The version shown in the pane.
 * @returns The button, or nothing before the first version.
 */
function PinButton(props: DraftPaneProps & { readonly shown: number | undefined }) {
  const { shown, data } = props;
  const disabled = props.busy || props.running;
  if (shown === undefined || data.thread.readOnly) return null;
  if (shown === data.dashboard?.pinnedVersion) {
    return (
      <Button disabled={disabled} onClick={props.onUnpin}>
        Unpin
      </Button>
    );
  }
  return (
    <Button variant="dark" disabled={disabled} onClick={() => props.onPin(shown)}>
      {shown === data.dashboard?.versions.at(-1)?.version ? 'Pin' : `Pin v${shown}`}
    </Button>
  );
}

/**
 * The words of the status pill: pinned, previewing a plan, or the thread's status.
 *
 * @param props - The pane's props.
 * @param status - The thread's status, in words.
 * @param pinned - The version the library shows, if any.
 * @returns The words.
 */
function pillText(props: DraftPaneProps, status: string, pinned: number | null): string {
  const shown = props.data.version?.version;
  if (shown !== undefined && shown === pinned) return `v${shown} · pinned`;
  return planPreviewOf(props) ? `v${shown} · plan preview` : status;
}

/**
 * The header of the pane: the title, the version and the one the library shows, Back, and Pin or
 * Unpin.
 *
 * @param props - The pane's props.
 * @returns The header.
 */
function PaneHeader(props: DraftPaneProps) {
  const { data, plan, running } = props;
  const shown = data.version?.version;
  const latest = data.dashboard?.versions.at(-1)?.version;
  const pinned = data.dashboard?.pinnedVersion ?? null;
  const status = statusOf(data.thread.state, running, props.stopped, shown, latest);
  return (
    <header className={styles.head}>
      <h2 className={styles.title}>
        {data.version?.spec.title ?? plan?.title ?? 'Untitled dashboard'}
      </h2>
      <Pill tone={status.tone} mono>
        {pillText(props, status.text, pinned)}
      </Pill>
      {pinned !== null && shown !== pinned && <Pill mono>library shows v{pinned}</Pill>}
      <span className={styles.spacer} />
      {shown !== undefined && shown !== latest && (
        <Button onClick={() => props.onShowVersion(undefined)}>Back to v{latest}</Button>
      )}
      <PinButton {...props} shown={shown} />
    </header>
  );
}

/** A waiting plan's preview on the draft: how it marks each panel, and the panels it adds. */
interface PlanPreview {
  /** The mark of each draft panel, by id. */
  readonly marks: Readonly<Record<string, PanelPlanMark>>;
  /** The panels the plan adds. */
  readonly added: readonly Extract<ChangeRow, { tag: 'new' }>[];
}

/**
 * The preview of a waiting plan that changes the latest version, if the pane shows one.
 *
 * @param props - The pane's props.
 * @returns The preview, or nothing when no change plan waits on the version shown.
 */
function planPreviewOf(props: DraftPaneProps): PlanPreview | undefined {
  const { data, plan } = props;
  const latest = data.dashboard?.versions.at(-1)?.version;
  if (data.thread.state !== 'plan_pending' || !plan || !data.version) return undefined;
  if (data.version.version !== latest) return undefined;
  const draft = draftPanelsOf(data.version.spec);
  if (!isChangePlan(plan, draft)) return undefined;
  const added = changeRows(plan, draft).filter(
    (row): row is Extract<ChangeRow, { tag: 'new' }> => row.tag === 'new',
  );
  return { marks: panelMarks(plan, draft), added };
}

/**
 * What the preview's marks mean.
 *
 * @returns The legend.
 */
function PreviewLegend() {
  return (
    <p className={styles.legend}>
      Plan preview:
      <span data-tag="changed">changed</span>
      <span data-tag="new">new</span>
      <span data-tag="removed">removed</span>
      <span data-tag="same">kept</span>
    </p>
  );
}

/**
 * The panels a waiting plan adds, as dashed placeholders after the draft's panels.
 *
 * @param props - The new panels.
 * @param props.panels - The plan's new panels.
 * @returns The placeholders.
 */
function NewPanels({ panels }: { readonly panels: PlanPreview['added'] }) {
  return (
    <div className={styles.skeleton}>
      {panels.map((panel) => (
        <div key={panel.title} className={styles.newPanel}>
          <span className={styles.newTitle}>{panel.title}</span>
          <span className={styles.newKind}>new · {panel.kind}</span>
          {panel.query && <code className={styles.newQuery}>{panel.query}</code>}
        </div>
      ))}
    </div>
  );
}

/**
 * The body of the pane: the version's canvas, the plan's skeleton, or a hint.
 *
 * @param props - The pane's props.
 * @returns The body content.
 */
function PaneBody(props: DraftPaneProps) {
  const { data, plan } = props;
  const { dashboard, version } = data;
  if (dashboard && version) {
    const preview = planPreviewOf(props);
    return (
      <>
        {preview && <PreviewLegend />}
        <DashboardCanvas
          dashboardId={dashboard.id}
          version={version.version}
          spec={version.spec}
          selectedPanelId={props.selectedPanelId}
          onSelectPanel={props.onSelectPanel}
          markedPanelIds={props.markedPanelIds}
          planMarks={preview?.marks}
        />
        {preview && preview.added.length > 0 && <NewPanels panels={preview.added} />}
      </>
    );
  }
  if (plan) return <PlanSkeleton plan={plan} />;
  return (
    <p className={styles.empty}>
      {props.running
        ? 'The agent is exploring your connectors. Its plan appears in the thread, and the dashboard here once you approve it.'
        : 'Ask a question. The dashboard appears here as the agent builds it.'}
    </p>
  );
}

/**
 * The right pane of a thread: the draft the agent builds, live, with the inspector under it.
 *
 * @param props - The thread data, the plan, the selection and the callbacks.
 * @returns The pane.
 */
export function DraftPane(props: DraftPaneProps) {
  const { dashboard, version } = props.data;
  const selected = version?.spec.panels.find((panel) => panel.id === props.selectedPanelId);
  return (
    <section className={styles.pane} aria-label="Dashboard draft">
      <PaneHeader {...props} />
      <div className={styles.body}>
        <PaneBody {...props} />
      </div>
      {dashboard && version && selected && (
        <Inspector
          dashboard={dashboard}
          version={version.version}
          spec={version.spec}
          panel={selected}
          onShowVersion={props.onShowVersion}
          onClose={() => props.onSelectPanel(undefined)}
        />
      )}
    </section>
  );
}
