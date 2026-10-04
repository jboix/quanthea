import type { DashboardSpec, PanelAlert } from '@quanthea/shared';
import type { CSSProperties } from 'react';
import { markerColorVar, markerSetsOf } from './marker-sets.ts';
import { alertSetId } from './panel-alerts.ts';
import styles from './variables-bar.module.css';

/** Props of {@link MarkerToggles}. */
interface MarkerTogglesProps {
  /** The spec, for its sets of markers. */
  readonly spec: DashboardSpec;
  /** The alerts linked to panels, whose firing periods the charts shade. */
  readonly alerts?: readonly PanelAlert[] | undefined;
  /** The ids of the sets the viewer hid. */
  readonly hidden: ReadonlySet<string>;
  /** Called to show or hide a set. */
  readonly onToggle: (id: string, shown: boolean) => void;
}

/** A toggle: the set's id, label, swatch colour and kind. */
interface Toggle {
  /** The set's id. */
  readonly id: string;
  /** Its label. */
  readonly label: string;
  /** Its swatch's colour. */
  readonly color: string;
  /** A set of markers draws lines; an alert shades its firing periods. */
  readonly kind: 'markers' | 'alert';
}

/**
 * The toggles: the sets of markers the charts show, then the evaluated alerts linked to panels.
 *
 * @param spec - The spec.
 * @param alerts - The linked alerts.
 * @returns The toggles.
 */
function togglesOf(spec: DashboardSpec, alerts: readonly PanelAlert[]): Toggle[] {
  const sets = markerSetsOf(spec).map((set) => ({
    id: set.id,
    label: set.label,
    color: markerColorVar(set.color),
    kind: 'markers' as const,
  }));
  const fired = alerts
    .filter((alert) => alert.evaluated)
    .map((alert) => ({
      id: alertSetId(alert.id),
      label: alert.title,
      color: 'var(--color-danger)',
      kind: 'alert' as const,
    }));
  return [...sets, ...fired];
}

/**
 * A toggle for each set of markers the charts show, with the set's colour and label, and one for
 * the firing periods of each alert linked to a panel, labelled with its title. A hidden set is
 * drawn on no chart. Nothing shows when there is nothing to toggle.
 *
 * @param props - The spec, the linked alerts, the hidden sets and the toggle callback.
 * @returns The toggles, or nothing.
 */
export function MarkerToggles({ spec, alerts = [], hidden, onToggle }: MarkerTogglesProps) {
  const toggles = togglesOf(spec, alerts);
  if (toggles.length === 0) return null;
  return (
    <fieldset className={styles.markerSets}>
      <legend className={styles.legend}>Markers</legend>
      {toggles.map((toggle) => {
        const shown = !hidden.has(toggle.id);
        const swatch = { '--marker-color': toggle.color } as CSSProperties;
        const what =
          toggle.kind === 'alert' ? 'when it fired, on its panels' : 'markers on every chart';
        return (
          <button
            key={toggle.id}
            type="button"
            className={styles.markerToggle}
            aria-pressed={shown}
            title={`${shown ? 'Hide' : 'Show'} ${toggle.label}: ${what}`}
            onClick={() => onToggle(toggle.id, !shown)}
          >
            <span
              className={styles.markerSwatch}
              data-kind={toggle.kind}
              style={swatch}
              aria-hidden="true"
            />
            {toggle.label}
          </button>
        );
      })}
    </fieldset>
  );
}
