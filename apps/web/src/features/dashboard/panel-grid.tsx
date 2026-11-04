/**
 * A grid of panels, airy or tight. On a tight grid each card learns from the variables its
 * wrapper sets which edges it shares and which corners stay rounded; the wrapper draws nothing.
 */
import type { Panel } from '@quanthea/shared';
import { type CSSProperties, type ReactNode, useMemo } from 'react';
import { useDensity } from '../../ui/density.ts';
import gridStyles from './panel-grid.module.css';
import { type PanelJoin, panelJoins } from './panel-joins.ts';
import styles from './panels.module.css';

/**
 * The variables a tight card reads: its radius per corner and the hairline it overlaps.
 *
 * @param join - How the panel joins its neighbours.
 * @returns The variables.
 */
function joinStyle(join: PanelJoin | undefined): CSSProperties {
  const [topLeft, topRight, bottomRight, bottomLeft] = (join?.rounded ?? []).map((round) =>
    round ? 'var(--radius-panel)' : '0',
  );
  return {
    '--corners': `${topLeft} ${topRight} ${bottomRight} ${bottomLeft}`,
    '--join-left': join?.left ? '-1px' : '0',
    '--join-top': join?.top ? '-1px' : '0',
  } as CSSProperties;
}

/**
 * A grid of panels, airy or compact as the viewer chose in their appearance settings.
 *
 * @param props - The panels and how to draw one.
 * @param props.panels - The panels.
 * @param props.card - Draws one panel.
 * @returns The grid.
 */
export function SpacedGrid({
  panels,
  card,
}: {
  readonly panels: readonly Panel[];
  readonly card: (panel: Panel) => ReactNode;
}) {
  const [density] = useDensity();
  const joins = useMemo(
    () => (density === 'compact' ? panelJoins(panels) : undefined),
    [panels, density],
  );
  if (!joins) return <div className={styles.grid}>{panels.map((panel) => card(panel))}</div>;
  return (
    <div className={`${styles.grid} ${gridStyles.tight}`}>
      {panels.map((panel) => (
        <div key={panel.id} className={gridStyles.join} style={joinStyle(joins.get(panel.id))}>
          {card(panel)}
        </div>
      ))}
    </div>
  );
}
