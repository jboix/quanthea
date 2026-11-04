import type { ReactNode } from 'react';
import panelStyles from './panels.module.css';

/**
 * The panel grid with a layer over it, when there is one.
 *
 * @param props - The grid and the layer.
 * @param props.overlay - The layer, if any.
 * @param props.children - The grid.
 * @returns The grid, under the layer.
 */
export function WithOverlay({
  overlay,
  children,
}: {
  readonly overlay: ReactNode;
  readonly children: ReactNode;
}) {
  if (!overlay) return children;
  return (
    <div className={panelStyles.editing}>
      {children}
      {overlay}
    </div>
  );
}
