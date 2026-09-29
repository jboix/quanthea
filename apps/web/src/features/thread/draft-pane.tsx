import type { Plan, ThreadState } from '@querent/shared';
import type { CSSProperties } from 'react';
import { Button } from '../../ui/button.tsx';
import { Pill } from '../../ui/pill.tsx';
import { DashboardCanvas } from '../dashboard/index.ts';
import type { ThreadData } from './data.ts';
import styles from './draft-pane.module.css';
import { Inspector } from './inspector.tsx';

/** Props of {@link DraftPane}. */
export interface DraftPaneProps {
  /** The thread, its dashboard and the version shown. */
  readonly data: ThreadData;
  /** The latest plan, for the skeleton before the first version. */
  readonly plan: Plan | undefined;
  /** Whether the agent is working. */
  readonly running: boolean;
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
 * @param shown - The version shown, if any.
 * @param latest - The latest version, if any.
 * @returns The pill's tone and words.
 */
function statusOf(
  state: ThreadState,
  running: boolean,
  shown: number | undefined,
  latest: number | undefined,
) {
  if (shown !== undefined && shown !== latest)
    return { tone: 'neutral', text: `v${shown} · comparing` } as const;
  if (shown !== undefined) return { tone: 'draft', text: `v${shown} · draft` } as const;
  if (state === 'plan_pending')
    return { tone: 'neutral', text: 'waiting for plan approval' } as const;
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
  const status = statusOf(data.thread.state, running, shown, latest);
  return (
    <header className={styles.head}>
      <h2 className={styles.title}>
        {data.version?.spec.title ?? plan?.title ?? 'Untitled dashboard'}
      </h2>
      <Pill tone={status.tone} mono>
        {shown !== undefined && shown === pinned ? `v${shown} · pinned` : status.text}
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
    return (
      <DashboardCanvas
        dashboardId={dashboard.id}
        version={version.version}
        spec={version.spec}
        selectedPanelId={props.selectedPanelId}
        onSelectPanel={props.onSelectPanel}
        markedPanelIds={props.markedPanelIds}
      />
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
