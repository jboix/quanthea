/**
 * Compares two dashboard specs: panels are matched by id and classified as added, removed, changed
 * or the same, with the fields that changed. Diff cards, Undo and variant plans read it.
 */
import type { DashboardSpec, Panel } from './dashboard.ts';

/** One changed field: its path and its value before and after, as text. */
export interface FieldChange {
  /** Where, such as `queries[0].expr` or `view.option.yAxis.type`. */
  readonly path: string;
  /** The value before, or `undefined` when the field was added. */
  readonly before: string | undefined;
  /** The value after, or `undefined` when the field was removed. */
  readonly after: string | undefined;
}

/** How one panel changed. */
export interface PanelDiff {
  /** The panel id. */
  readonly id: string;
  /** The title after the change, or before it for a removed panel. */
  readonly title: string;
  /** What happened to the panel. */
  readonly status: 'added' | 'removed' | 'changed' | 'same';
  /** The fields that changed, for a changed panel. */
  readonly changes: readonly FieldChange[];
}

/** How a spec changed. */
export interface SpecDiff {
  /** Every panel of either spec: the new order first, then the removed ones. */
  readonly panels: readonly PanelDiff[];
  /** Changes outside the panels: title, time, variables, annotations. */
  readonly dashboard: readonly FieldChange[];
}

/** A JSON value, as specs hold them. */
type Json = string | number | boolean | null | undefined | Json[] | { [key: string]: Json };

/**
 * Writes a leaf value as text: strings as they are, everything else as JSON.
 *
 * @param value - The value.
 * @returns The text, or `undefined` for a missing value.
 */
function textOf(value: Json): string | undefined {
  if (value === undefined) return undefined;
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/**
 * Whether a value is compared field by field rather than as a whole.
 *
 * @param value - The value.
 * @returns Whether it is a plain object.
 */
function isRecord(value: Json): value is { [key: string]: Json } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Joins a path and a key the way the spec document writes paths.
 *
 * @param path - The parent path.
 * @param key - A key or an index.
 * @returns Such as `queries[0].expr`.
 */
function join(path: string, key: string | number): string {
  if (typeof key === 'number') return `${path}[${key}]`;
  return path === '' ? key : `${path}.${key}`;
}

/**
 * The changes between two values. Objects and arrays are compared member by member; leaves are
 * compared as text.
 *
 * @param before - The old value.
 * @param after - The new value.
 * @param path - Their path.
 * @returns The changed leaves.
 */
function changesBetween(before: Json, after: Json, path: string): FieldChange[] {
  if (Array.isArray(before) && Array.isArray(after)) {
    const length = Math.max(before.length, after.length);
    return Array.from({ length }, (_item, index) =>
      changesBetween(before[index], after[index], join(path, index)),
    ).flat();
  }
  if (isRecord(before) && isRecord(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
    return keys.flatMap((key) => changesBetween(before[key], after[key], join(path, key)));
  }
  const [was, is] = [textOf(before), textOf(after)];
  return was === is ? [] : [{ path, before: was, after: is }];
}

/**
 * The diff of one panel present in either spec.
 *
 * @param before - The old panel, if any.
 * @param after - The new panel, if any.
 * @returns The panel diff.
 */
function panelDiff(before: Panel | undefined, after: Panel | undefined): PanelDiff {
  const panel = (after ?? before) as Panel;
  if (!before) return { id: panel.id, title: panel.title, status: 'added', changes: [] };
  if (!after) return { id: panel.id, title: panel.title, status: 'removed', changes: [] };
  const { id: _before, ...oldFields } = before;
  const { id: _after, ...newFields } = after;
  const changes = changesBetween(oldFields as Json, newFields as Json, '');
  return {
    id: panel.id,
    title: panel.title,
    status: changes.length > 0 ? 'changed' : 'same',
    changes,
  };
}

/**
 * Compares two specs.
 *
 * @param before - The old spec.
 * @param after - The new spec.
 * @returns The diff.
 */
export function diffSpecs(before: DashboardSpec, after: DashboardSpec): SpecDiff {
  const oldPanels = new Map(before.panels.map((panel) => [panel.id, panel]));
  const newIds = new Set(after.panels.map((panel) => panel.id));
  const panels = [
    ...after.panels.map((panel) => panelDiff(oldPanels.get(panel.id), panel)),
    ...before.panels
      .filter((panel) => !newIds.has(panel.id))
      .map((panel) => panelDiff(panel, undefined)),
  ];
  const { panels: _old, ...oldDashboard } = before;
  const { panels: _new, ...newDashboard } = after;
  return { panels, dashboard: changesBetween(oldDashboard as Json, newDashboard as Json, '') };
}

/** One line of a text diff. */
export interface DiffLine {
  /** `-` removed, `+` added, ` ` kept. */
  readonly kind: '-' | '+' | ' ';
  /** The line. */
  readonly text: string;
}

/**
 * Fills one row of the table of common run lengths.
 *
 * @param lengths - The table, filled below this row.
 * @param a - The old lines.
 * @param b - The new lines.
 * @param i - The row: a position in the old lines.
 */
function fillRow(lengths: number[][], a: readonly string[], b: readonly string[], i: number): void {
  const row = lengths[i] as number[];
  const below = lengths[i + 1] as number[];
  for (let j = b.length - 1; j >= 0; j -= 1) {
    row[j] = a[i] === b[j] ? (below[j + 1] ?? 0) + 1 : Math.max(below[j] ?? 0, row[j + 1] ?? 0);
  }
}

/**
 * Whether the walk takes the next new line as added, rather than the next old line as removed.
 *
 * @param a - The old lines.
 * @param b - The new lines.
 * @param lengths - The common run lengths.
 * @param position - The positions in the old and new lines.
 * @returns Whether to add.
 */
function addsNext(
  a: readonly string[],
  b: readonly string[],
  lengths: readonly number[][],
  [i, j]: readonly [number, number],
): boolean {
  if (j >= b.length) return false;
  if (i >= a.length) return true;
  // On a tie the old line goes first, so removals read before additions.
  return (lengths[i]?.[j + 1] ?? 0) > (lengths[i + 1]?.[j] ?? 0);
}

/**
 * One step of the walk through the table: the next diff line and the positions after it.
 *
 * @param a - The old lines.
 * @param b - The new lines.
 * @param lengths - The common run lengths.
 * @param position - The positions in the old and new lines.
 * @returns The line and the next positions.
 */
function step(
  a: readonly string[],
  b: readonly string[],
  lengths: readonly number[][],
  position: readonly [number, number],
): [DiffLine, [number, number]] {
  const [i, j] = position;
  const same = i < a.length && j < b.length && a[i] === b[j];
  if (same) return [{ kind: ' ', text: a[i] ?? '' }, [i + 1, j + 1]];
  if (addsNext(a, b, lengths, position)) return [{ kind: '+', text: b[j] ?? '' }, [i, j + 1]];
  return [{ kind: '-', text: a[i] ?? '' }, [i + 1, j]];
}

/**
 * Diffs two texts line by line, keeping the longest common run of lines.
 *
 * @param before - The old text.
 * @param after - The new text.
 * @returns The lines, in order.
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const [a, b] = [before.split('\n'), after.split('\n')];
  const lengths = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i -= 1) fillRow(lengths, a, b, i);
  const lines: DiffLine[] = [];
  let position: [number, number] = [0, 0];
  while (position[0] < a.length || position[1] < b.length) {
    const [line, next] = step(a, b, lengths, position);
    lines.push(line);
    position = next;
  }
  return lines;
}
