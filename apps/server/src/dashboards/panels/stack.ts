/**
 * The `stack` arrangement: two or three numbers stacked in a column on the left, and one or two
 * panels beside them, all as tall as the stack, so the row reads as one even block.
 */
import { gridColumns, type Panel } from '@quanthea/shared';
import { QueryError } from '../queries/index.ts';
import { heights } from './layout.ts';
import { shapeOfPanel } from './layout-map.ts';

/** The columns the stack of numbers takes. */
const stackColumns = 3;

/** The columns the wider of two panels beside the stack takes. */
const widerColumns = 5;

/** What `stack` takes, said when a row does not fit it. */
const stackForm =
  '"stack" takes two or three numbers, then one or two panels beside them, such as ["stack", "Revenue", "Orders", "Revenue over time"].';

/**
 * Splits a stack row into its numbers and the panels beside them, checking its form.
 *
 * @param panels - The row's panels, in order.
 * @returns The numbers and the panels beside them.
 * @throws {QueryError} When the row does not start with two or three numbers and end with one or
 *   two other panels.
 */
function stackParts(panels: readonly Panel[]) {
  const numbers = panels.filter((panel) => shapeOfPanel(panel) === 'stat');
  const beside = panels.slice(numbers.length);
  const ordered = panels.slice(0, numbers.length).every((panel) => shapeOfPanel(panel) === 'stat');
  const fits = ordered && numbers.length >= 2 && numbers.length <= 3;
  if (!fits || beside.length < 1 || beside.length > 2) throw new QueryError(stackForm);
  return { numbers, beside };
}

/**
 * The widths of the panels beside the stack: the rest of the row, and a table the narrower of two.
 *
 * @param beside - The panels beside the stack.
 * @returns Their widths.
 */
function besideWidths(beside: readonly Panel[]): number[] {
  const rest = gridColumns - stackColumns;
  if (beside.length === 1) return [rest];
  const tableFirst = beside[0] !== undefined && shapeOfPanel(beside[0]) === 'table';
  return tableFirst ? [rest - widerColumns, widerColumns] : [widerColumns, rest - widerColumns];
}

/**
 * Places a stack row from a grid line down. Each number is as tall as the panels beside it allow
 * shared evenly, and at least a number's usual height; the panels beside take the stack's height.
 *
 * @param panels - The row's panels: the numbers, then the panels beside them.
 * @param top - The grid line the row starts on.
 * @returns The panels in place, and the grid line below them.
 * @throws {QueryError} When the row does not fit the form of `stack`.
 */
export function placeStack(panels: readonly Panel[], top: number) {
  const { numbers, beside } = stackParts(panels);
  const tallest = Math.max(...beside.map((panel) => heights[shapeOfPanel(panel)]));
  const each = Math.max(heights.stat, Math.ceil(tallest / numbers.length));
  const height = each * numbers.length;
  const stacked = numbers.map((panel, index) => ({
    ...panel,
    grid: { x: 0, y: top + index * each, w: stackColumns, h: each },
  }));
  const widths = besideWidths(beside);
  let x = stackColumns;
  const placed = beside.map((panel, index) => {
    const w = widths[index] ?? 0;
    const grid = { x, y: top, w, h: height };
    x += w;
    return { ...panel, grid };
  });
  return { placed: [...stacked, ...placed], bottom: top + height };
}
