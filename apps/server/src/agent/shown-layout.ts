/**
 * The layout people see: the pinned version of the thread's dashboard as someone arranged it by
 * hand. Every version the agent writes starts from that arrangement, and the agent asks about the
 * panels hidden there. It never writes a layout; only people do.
 */
import { type DashboardSpec, type PanelGrid, packGrid } from '@quanthea/shared';
import type { RunContext } from './run-context.ts';

/** One panel of the shown layout. */
interface ShownPanel {
  /** The panel's id. */
  readonly id: string;
  /** Its title in the pinned version. */
  readonly title: string;
  /** Where it sits and how big it is. */
  readonly grid: PanelGrid;
  /** Where the pinned version's spec puts it, before the hand layout. */
  readonly specGrid: PanelGrid | undefined;
  /** Whether it is hidden. */
  readonly hidden: boolean;
}

/** The pinned version as people see it, arranged by hand. */
export interface ShownLayoutFacts {
  /** The version pinned. */
  readonly version: number;
  /** Its panels as arranged. */
  readonly panels: readonly ShownPanel[];
}

/**
 * The hand layout of the version the library shows, if it has one.
 *
 * @param context - The run.
 * @param dashboardId - The thread's dashboard.
 * @returns The layout with each panel's title, or `undefined` when nothing is pinned or the
 *   pinned version shows its spec as written.
 */
export function shownLayoutOf(
  context: Pick<RunContext, 'dashboards'>,
  dashboardId: string,
): ShownLayoutFacts | undefined {
  const { pinnedVersion } = context.dashboards.get(dashboardId, 'editor');
  if (pinnedVersion === null) return undefined;
  const { spec, layout } = context.dashboards.getVersion(dashboardId, pinnedVersion, 'editor');
  if (!layout) return undefined;
  const pinned = new Map(spec.panels.map((panel) => [panel.id, panel]));
  const panels = layout.layout.panels.map((panel) => ({
    ...panel,
    title: pinned.get(panel.id)?.title ?? panel.id,
    specGrid: pinned.get(panel.id)?.grid,
  }));
  return { version: pinnedVersion, panels };
}

/**
 * What the agent is told about the hand layout: follow it, and ask about what it hides.
 *
 * @param shown - The hand layout.
 * @param mayAsk - Whether the phase offers `ask_person`; building an approved plan does not.
 * @returns The lines.
 */
export function shownLayoutLines(shown: ShownLayoutFacts, mayAsk: boolean): string[] {
  const places = shown.panels
    .filter((panel) => !panel.hidden)
    .map(({ id, grid }) => `${id} x${grid.x} y${grid.y} w${grid.w} h${grid.h}`)
    .join('; ');
  const lines = [
    `People see pinned version ${shown.version} as someone arranged it by hand: ${places}. Every version you write starts from this arrangement, so leave the panels' widths alone unless the person asks to rearrange.`,
  ];
  const hidden = shown.panels.filter((panel) => panel.hidden);
  if (hidden.length === 0) return lines;
  const named = hidden.map((panel) => `${panel.id} ("${panel.title}")`).join(', ');
  const ask = mayAsk
    ? ' Before you next change the dashboard, ask the person once, with ask_person, whether to remove them from the next version. Do as they say, and do not ask again in this thread.'
    : ' Keep them in the version you write: the person decides about them later.';
  return [...lines, `Hidden there by hand: ${named}.${ask}`];
}

/**
 * Whether two places are the same.
 *
 * @param first - One place.
 * @param second - The other, if any.
 * @returns Whether they match.
 */
function samePlace(first: PanelGrid, second: PanelGrid | undefined): boolean {
  return (
    second !== undefined &&
    first.x === second.x &&
    first.y === second.y &&
    first.w === second.w &&
    first.h === second.h
  );
}

/**
 * A draft arranged as people see the pinned version: each panel shown there takes its place and
 * size, while the draft still has it where the pinned version's spec put it; then the panels are
 * packed. A panel a draft moved or resized since keeps the draft's place, and so do panels hidden
 * there and panels the pinned version lacks.
 *
 * @param context - The run.
 * @param spec - The thread's current draft, if any.
 * @returns The draft to write the next version from.
 */
export function arrangedAsShown(
  context: Pick<RunContext, 'dashboards' | 'threads' | 'threadId'>,
  spec: DashboardSpec | undefined,
): DashboardSpec | undefined {
  const { dashboardId } = context.threads.row(context.threadId);
  const shown = spec && dashboardId !== null ? shownLayoutOf(context, dashboardId) : undefined;
  if (!spec || !shown) return spec;
  const arranged = new Map(
    shown.panels.filter((panel) => !panel.hidden).map((panel) => [panel.id, panel]),
  );
  const panels = spec.panels.map((panel) => {
    const hand = arranged.get(panel.id);
    return hand && samePlace(panel.grid, hand.specGrid) ? { ...panel, grid: hand.grid } : panel;
  });
  return { ...spec, panels: packGrid(panels) };
}
