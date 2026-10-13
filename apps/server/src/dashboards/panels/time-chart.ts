/** Which views are charts over time. It imports nothing of the panels, so a run can read it. */
import type { View } from '@quanthea/shared';

/**
 * Whether a view is a chart over time, which deploy markers go on.
 *
 * @param view - The view.
 * @returns Whether its x axis is a time axis.
 */
export function isTimeChart(view: View): boolean {
  if (view.kind !== 'chart') return false;
  const xAxis = view.option.xAxis;
  const axes = Array.isArray(xAxis) ? xAxis : [xAxis];
  return axes.some(
    (axis) =>
      typeof axis === 'object' && axis !== null && !Array.isArray(axis) && axis.type === 'time',
  );
}
