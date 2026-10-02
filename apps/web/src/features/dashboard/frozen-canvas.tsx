/**
 * A snapshot's dashboard: the time range and variables it was taken with, which can't change, and
 * its panels drawn from the results frozen with it. Nothing runs; only the markers can be shown or
 * hidden, in the page.
 */
import type { DashboardSpec, PanelRun, VariableValues } from '@quanthea/shared';
import { useState } from 'react';
import type { Loaded } from './data.ts';
import { MarkerToggles } from './marker-toggles.tsx';
import { PanelFrame } from './panel-card.tsx';
import panelStyles from './panels.module.css';
import { shown } from './variable-chip.tsx';
import styles from './variables-bar.module.css';
import { timeLabel } from './view-state.ts';

/** Props of {@link FrozenCanvas}. */
export interface FrozenCanvasProps {
  /** The spec of the version frozen. */
  readonly spec: DashboardSpec;
  /** Each panel's frozen run, by panel id. */
  readonly panels: Readonly<Record<string, PanelRun>>;
  /** The time range the panels ran over, in epoch milliseconds. */
  readonly time: { readonly from: number; readonly to: number };
  /** The variable values the panels ran with. */
  readonly variables: VariableValues;
  /** The sets of markers hidden when it was taken. */
  readonly hiddenMarkers: readonly string[];
}

/** The class of a chip that can't be changed. */
const frozenChip = `${styles.chipButton} ${styles.frozen}`;

/**
 * Shows or hides sets of markers in the page, starting from the ones hidden when it was taken.
 *
 * @param initial - The sets hidden at first.
 * @returns The hidden sets, and the toggle.
 */
function useHiddenMarkers(initial: readonly string[]) {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set(initial));
  const toggle = (id: string, show: boolean) =>
    setHidden((current) => {
      const next = new Set(current);
      if (show) next.delete(id);
      else next.add(id);
      return next;
    });
  return { hidden, toggle };
}

/**
 * The time range and the variables, as chips that can't be changed, and the markers' toggles.
 *
 * @param props - The canvas props, the hidden sets and the toggle.
 * @returns The bar.
 */
function FrozenBar(props: FrozenCanvasProps & ReturnType<typeof useHiddenMarkers>) {
  const { spec, time, variables } = props;
  const range = { from: new Date(time.from).toISOString(), to: new Date(time.to).toISOString() };
  return (
    <div className={styles.bar}>
      <span className={frozenChip} title="Fixed when the snapshot was taken">
        <span className={styles.chipName}>time</span>
        {timeLabel(range, spec.timezone)}
      </span>
      {spec.variables.map((variable) => (
        <span key={variable.name} className={frozenChip}>
          <span className={styles.chipName}>${variable.name}</span>
          {shown(variables[variable.name] ?? 'default')}
        </span>
      ))}
      <MarkerToggles spec={spec} hidden={props.hidden} onToggle={props.toggle} />
    </div>
  );
}

/**
 * A panel's frozen run, or why it has none.
 *
 * @param run - The run, if the snapshot holds one for the panel.
 * @returns What the panel shows.
 */
function frozenRun(run: PanelRun | undefined): Loaded<PanelRun> {
  return run ? { ok: true, value: run } : { ok: false, message: 'Not in this snapshot.' };
}

/**
 * The bar and the panels of a snapshot, drawn from its frozen results.
 *
 * @param props - The spec, the runs, the range, the variables and the hidden markers.
 * @returns The canvas.
 */
export function FrozenCanvas(props: FrozenCanvasProps) {
  const markers = useHiddenMarkers(props.hiddenMarkers);
  return (
    <>
      <FrozenBar {...props} {...markers} />
      <div className={panelStyles.grid}>
        {props.spec.panels.map((panel) => (
          <PanelFrame
            key={panel.id}
            panel={panel}
            spec={props.spec}
            run={frozenRun(props.panels[panel.id])}
            loading={false}
            hiddenMarkers={markers.hidden}
          />
        ))}
      </div>
    </>
  );
}
