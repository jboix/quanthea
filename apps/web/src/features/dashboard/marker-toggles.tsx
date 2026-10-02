import type { DashboardSpec } from '@quanthea/shared';
import type { CSSProperties } from 'react';
import { markerColorVar, markerSetsOf } from './marker-sets.ts';
import styles from './variables-bar.module.css';

/** Props of {@link MarkerToggles}. */
interface MarkerTogglesProps {
  /** The spec, for its sets of markers. */
  readonly spec: DashboardSpec;
  /** The ids of the sets the viewer hid. */
  readonly hidden: ReadonlySet<string>;
  /** Called to show or hide a set. */
  readonly onToggle: (id: string, shown: boolean) => void;
}

/**
 * A toggle for each set of markers the charts show, with the set's colour and label. A hidden set
 * is drawn on no chart. Nothing shows when no chart has markers.
 *
 * @param props - The spec, the hidden sets and the toggle callback.
 * @returns The toggles, or nothing.
 */
export function MarkerToggles({ spec, hidden, onToggle }: MarkerTogglesProps) {
  const sets = markerSetsOf(spec);
  if (sets.length === 0) return null;
  return (
    <fieldset className={styles.markerSets}>
      <legend className={styles.legend}>Markers</legend>
      {sets.map((set) => {
        const shown = !hidden.has(set.id);
        const swatch = { '--marker-color': markerColorVar(set.color) } as CSSProperties;
        return (
          <button
            key={set.id}
            type="button"
            className={styles.markerToggle}
            aria-pressed={shown}
            title={`${shown ? 'Hide' : 'Show'} the ${set.label} markers on every chart`}
            onClick={() => onToggle(set.id, !shown)}
          >
            <span className={styles.markerSwatch} style={swatch} aria-hidden="true" />
            {set.label}
          </button>
        );
      })}
    </fieldset>
  );
}
