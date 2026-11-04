/**
 * Dragging a frame with the pointer. A moved panel floats under the pointer as a ghost while its
 * frame marks where it lands, the others making way; over another section, it lands there. A
 * resized panel grows from its corner, the others moving out of its way.
 */
import type { DashboardLayout, LayoutPanel, PanelGrid } from '@quanthea/shared';
import { type PointerEvent, type RefObject, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { type DropTarget, dropCell, dropTargetAt } from './layout-drop.ts';
import { cellsOf, type GridMetrics, placePanel, resizePanel, settle } from './layout-edit.ts';
import type { SectionMoves } from './layout-frame-menu.tsx';
import styles from './layout-overlay.module.css';

/** The grid's row height and gap, in pixels, as `panels.module.css` sets them. */
const gridSpacing = { rowHeight: 40, gap: 16 };

/** What a drag changes, and where it drops. */
export interface DragProps {
  /** The layout being edited. */
  readonly layout: DashboardLayout;
  /** Called with each change. */
  readonly onChange: (layout: DashboardLayout) => void;
  /** Where a panel can move to, while a dashboard's sections are arranged. */
  readonly sections?: SectionMoves | undefined;
}

/** A drag under way. */
export interface Drag {
  /** The panel dragged. */
  readonly id: string;
  /** Whether it moves or resizes. */
  readonly mode: 'move' | 'resize';
  /** Where the pointer went down. */
  readonly x: number;
  /** Where the pointer went down. */
  readonly y: number;
  /** The layout when the drag began. */
  readonly base: DashboardLayout;
  /** The panel's place when the drag began. */
  readonly grid: PanelGrid;
  /** Where the pointer went down in the frame, from its top left corner. */
  readonly offset: { readonly x: number; readonly y: number };
}

/** The panel floating under the pointer, in viewport pixels. */
export interface Ghost {
  /** The panel. */
  readonly id: string;
  /** Its left edge. */
  readonly left: number;
  /** Its top edge. */
  readonly top: number;
  /** Its width. */
  readonly width: number;
  /** Its height. */
  readonly height: number;
}

/**
 * The grid's size on screen.
 *
 * @param element - The overlay.
 * @returns The width of a column, the row height and the gap.
 */
function metricsOf(element: HTMLElement | null): GridMetrics {
  const width = element?.clientWidth ?? 0;
  const columnWidth = (width - gridSpacing.gap * 11) / 12;
  return { columnWidth, ...gridSpacing };
}

/**
 * The layout after a drag reached a point.
 *
 * @param drag - The drag.
 * @param event - The pointer event.
 * @param element - The overlay, to measure the grid.
 * @returns The layout: a moved panel where it lands, a resized one held at its new size.
 */
function dragged(drag: Drag, event: PointerEvent, element: HTMLElement | null): DashboardLayout {
  const { columns, rows } = cellsOf(
    event.clientX - drag.x,
    event.clientY - drag.y,
    metricsOf(element),
  );
  const { grid } = drag;
  return drag.mode === 'move'
    ? placePanel(drag.base, drag.id, { x: grid.x + columns, y: grid.y + rows }, rows > 0)
    : resizePanel(drag.base, drag.id, { w: grid.w + columns, h: grid.h + rows });
}

/**
 * The other section a move is over, while sections are arranged.
 *
 * @param drag - The drag.
 * @param event - The pointer event.
 * @param sections - The sections, if arranged.
 * @returns The section under the pointer, or `undefined` over the drag's own.
 */
function crossTarget(drag: Drag, event: PointerEvent, sections: SectionMoves | undefined) {
  if (!sections || drag.mode !== 'move') return undefined;
  return dropTargetAt(event.clientX, event.clientY, sections.current);
}

/**
 * Ends a drag: on another section, the panel lands there at the cell under its top left corner, or
 * at the section's foot while it shows no grid; otherwise the layout settles.
 *
 * @param drag - The drag.
 * @param target - The other section under the pointer, if any.
 * @param event - The pointer event.
 * @param props - The change callback and the sections.
 * @param layout - The layout as the drag left it.
 */
function finish(
  drag: Drag,
  target: DropTarget | undefined,
  event: PointerEvent,
  props: DragProps,
  layout: DashboardLayout,
) {
  const sections = props.sections;
  if (!(target && sections)) return props.onChange(settle(layout));
  const corner = { x: event.clientX - drag.offset.x, y: event.clientY - drag.offset.y };
  sections.onHover(null);
  sections.onDrop(drag.id, target.section, target.grid ? dropCell(target.grid, corner) : undefined);
}

/**
 * Starts a drag from a pointer press on a frame, which it claims: no other handler sees it.
 *
 * @param event - The press.
 * @param panel - The panel.
 * @param mode - Whether it moves or resizes.
 * @param base - The layout when the drag began.
 * @returns The drag, and the frame's box on screen.
 */
function dragFrom(
  event: PointerEvent,
  panel: LayoutPanel,
  mode: Drag['mode'],
  base: DashboardLayout,
) {
  event.preventDefault();
  event.stopPropagation();
  const box = (event.currentTarget as Element).closest('[data-frame]')?.getBoundingClientRect();
  const offset = { x: event.clientX - (box?.left ?? 0), y: event.clientY - (box?.top ?? 0) };
  const drag = { id: panel.id, mode, x: event.clientX, y: event.clientY, base, grid: panel.grid };
  return { drag: { ...drag, offset }, box };
}

/**
 * The ghost of a moved panel after the pointer reached a point.
 *
 * @param drag - The drag.
 * @param box - The frame's box when the drag began.
 * @param event - The pointer event.
 * @returns The ghost, or `null` for a resize.
 */
function ghostAt(drag: Drag, box: DOMRect | undefined, event: PointerEvent): Ghost | null {
  if (drag.mode !== 'move' || !box) return null;
  const { width, height } = box;
  const left = event.clientX - drag.offset.x;
  return { id: drag.id, left, top: event.clientY - drag.offset.y, width, height };
}

/**
 * Dragging frames with a pointer: the overlay captures the pointer, so a drag goes on outside the
 * frame it started on. Over another section, the panel's own section shows as it was.
 *
 * @param props - The layout, the change callback and the sections.
 * @param overlay - The overlay element.
 * @returns The handlers, the panel being dragged, and its ghost.
 */
export function usePointerDrag(props: DragProps, overlay: RefObject<HTMLDivElement | null>) {
  const drag = useRef<{ drag: Drag; box: DOMRect | undefined } | null>(null);
  const over = useRef<DropTarget | undefined>(undefined);
  const latest = useRef(props.layout);
  latest.current = props.layout;
  const [shown, setShown] = useState<{ id: string; ghost: Ghost | null } | null>(null);
  const start = (event: PointerEvent, panel: LayoutPanel, mode: Drag['mode']) => {
    if (event.button !== 0) return;
    overlay.current?.setPointerCapture(event.pointerId);
    drag.current = dragFrom(event, panel, mode, latest.current);
    setShown({ id: panel.id, ghost: null });
  };
  const move = (event: PointerEvent) => {
    if (!drag.current) return;
    const current = drag.current.drag;
    over.current = crossTarget(current, event, props.sections);
    props.sections?.onHover(over.current ? over.current.section : null);
    props.onChange(over.current ? current.base : dragged(current, event, overlay.current));
    setShown({ id: current.id, ghost: ghostAt(current, drag.current.box, event) });
  };
  const end = (event: PointerEvent) => {
    const current = drag.current?.drag;
    if (!current) return;
    drag.current = null;
    setShown(null);
    finish(current, over.current, event, props, latest.current);
    over.current = undefined;
  };
  return { start, move, end, active: shown?.id ?? null, ghost: shown?.ghost ?? null };
}

/**
 * The moved panel floating under the pointer, above every section.
 *
 * @param props - The ghost and the panels' titles.
 * @param props.ghost - Where it floats, or `null` while no panel is moved.
 * @param props.titles - Each panel's title, by id.
 * @returns The ghost, drawn on the page's body.
 */
export function DragGhost({
  ghost,
  titles,
}: {
  readonly ghost: Ghost | null;
  readonly titles: ReadonlyMap<string, string>;
}) {
  if (!ghost) return null;
  const { left, top, width, height } = ghost;
  return createPortal(
    <div className={styles.ghost} style={{ left, top, width, height }} aria-hidden="true">
      <span className={styles.label}>{titles.get(ghost.id) ?? ghost.id}</span>
    </div>,
    document.body,
  );
}
