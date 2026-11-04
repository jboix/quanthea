/**
 * The edit layer over a dashboard's live panels: one frame per shown panel, on the same 12-column
 * grid. Drag a frame to move its panel, drag its corner to resize it; with the keyboard, the arrow
 * keys move the focused panel and Shift with an arrow resizes it. Each change is announced.
 */
import type { DashboardLayout, LayoutPanel, PanelGrid } from '@quanthea/shared';
import {
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
  useRef,
  useState,
} from 'react';
import { type DropTarget, dropCell, dropTargetAt } from './layout-drop.ts';
import {
  cellsOf,
  type GridMetrics,
  hidePanel,
  movePanel,
  resizePanel,
  settle,
  setWidth,
} from './layout-edit.ts';
import { FrameMenu, type QuickAction, type SectionMoves } from './layout-frame-menu.tsx';
import styles from './layout-overlay.module.css';

/** The grid's row height and gap, in pixels, as `panels.module.css` sets them. */
const gridSpacing = { rowHeight: 40, gap: 16 };

/** Props of {@link LayoutOverlay}. */
export interface LayoutOverlayProps {
  /** The layout being edited. */
  readonly layout: DashboardLayout;
  /** Each panel's title, by id. */
  readonly titles: ReadonlyMap<string, string>;
  /** Called with each change. */
  readonly onChange: (layout: DashboardLayout) => void;
  /** Where a panel can move to, while a dashboard's sections are arranged. */
  readonly sections?: SectionMoves | undefined;
}

/** A drag under way. */
interface Drag {
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
 * @returns The layout, the dragged panel held where the pointer put it.
 */
function dragged(drag: Drag, event: PointerEvent, element: HTMLElement | null): DashboardLayout {
  const { columns, rows } = cellsOf(
    event.clientX - drag.x,
    event.clientY - drag.y,
    metricsOf(element),
  );
  const { grid } = drag;
  return drag.mode === 'move'
    ? movePanel(drag.base, drag.id, { x: grid.x + columns, y: grid.y + rows })
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
 * Drops a panel on another section, at the cell under its top left corner, or at the section's
 * foot while it shows no grid.
 *
 * @param drag - The drag.
 * @param target - The section dropped on.
 * @param event - The pointer event.
 * @param sections - The sections.
 */
function dropOn(drag: Drag, target: DropTarget, event: PointerEvent, sections: SectionMoves) {
  const corner = { x: event.clientX - drag.offset.x, y: event.clientY - drag.offset.y };
  sections.onHover(null);
  sections.onDrop(drag.id, target.section, target.grid ? dropCell(target.grid, corner) : undefined);
}

/**
 * Ends a drag: on another section, the panel drops there; otherwise the layout settles.
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
  props: LayoutOverlayProps,
  layout: DashboardLayout,
) {
  if (target && props.sections) dropOn(drag, target, event, props.sections);
  else props.onChange(settle(layout));
}

/**
 * Starts a drag from a pointer press on a frame, which it claims: no other handler sees it.
 *
 * @param event - The press.
 * @param panel - The panel.
 * @param mode - Whether it moves or resizes.
 * @param base - The layout when the drag began.
 * @returns The drag.
 */
function dragFrom(
  event: PointerEvent,
  panel: LayoutPanel,
  mode: Drag['mode'],
  base: DashboardLayout,
) {
  event.preventDefault();
  event.stopPropagation();
  const frame = (event.currentTarget as Element).closest('[data-frame]')?.getBoundingClientRect();
  const offset = { x: event.clientX - (frame?.left ?? 0), y: event.clientY - (frame?.top ?? 0) };
  return { id: panel.id, mode, x: event.clientX, y: event.clientY, base, grid: panel.grid, offset };
}

/**
 * Dragging frames with a pointer: the overlay captures the pointer, so a drag goes on outside the
 * frame it started on. Over another section, the panel stays where it was and drops there.
 *
 * @param props - The layout, the change callback and the sections.
 * @param overlay - The overlay element.
 * @returns The handlers, and the panel being dragged.
 */
function usePointerDrag(props: LayoutOverlayProps, overlay: RefObject<HTMLDivElement | null>) {
  const drag = useRef<Drag | null>(null);
  const over = useRef<DropTarget | undefined>(undefined);
  const latest = useRef(props.layout);
  latest.current = props.layout;
  const [active, setActive] = useState<string | null>(null);
  const start = (event: PointerEvent, panel: LayoutPanel, mode: Drag['mode']) => {
    if (event.button !== 0) return;
    overlay.current?.setPointerCapture(event.pointerId);
    drag.current = dragFrom(event, panel, mode, latest.current);
    setActive(panel.id);
  };
  const move = (event: PointerEvent) => {
    const current = drag.current;
    if (!current) return;
    over.current = crossTarget(current, event, props.sections);
    props.sections?.onHover(over.current ? over.current.section : null);
    props.onChange(over.current ? current.base : dragged(current, event, overlay.current));
  };
  const end = (event: PointerEvent) => {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    setActive(null);
    finish(current, over.current, event, props, latest.current);
    over.current = undefined;
  };
  return { start, move, end, active };
}

/** What each arrow key does to a place. */
const steps: Readonly<Record<string, { readonly x: number; readonly y: number }>> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};

/**
 * Moves or resizes the focused panel by one cell with the arrow keys, Shift to resize; H hides it.
 *
 * @param event - The key event.
 * @param layout - The layout.
 * @param panel - The focused panel.
 * @returns The layout after the key, or `undefined` for a key that does nothing here.
 */
function keyed(
  event: KeyboardEvent,
  layout: DashboardLayout,
  panel: LayoutPanel,
): DashboardLayout | undefined {
  const plain = !(event.ctrlKey || event.metaKey || event.altKey);
  if (plain && event.key.toLowerCase() === 'h') return hidePanel(layout, panel.id);
  const step = steps[event.key];
  if (!step) return undefined;
  const { x, y, w, h } = panel.grid;
  const changed = event.shiftKey
    ? resizePanel(layout, panel.id, { w: w + step.x, h: h + step.y })
    : movePanel(layout, panel.id, { x: x + step.x, y: y + step.y });
  return settle(changed, panel.id);
}

/**
 * Where a place sits on the grid, as the custom properties the stylesheet reads.
 *
 * @param grid - The place.
 * @returns The style.
 */
function placeStyle(grid: PanelGrid): CSSProperties {
  return {
    '--column': `${grid.x + 1} / span ${grid.w}`,
    '--row': `${grid.y + 1} / span ${grid.h}`,
  } as CSSProperties;
}

/**
 * How a panel's place reads aloud.
 *
 * @param title - The panel's title.
 * @param grid - Its place.
 * @returns Such as `Errors: column 1, row 4, 6 columns wide, 3 rows high`.
 */
function placeWords(title: string, grid: PanelGrid): string {
  return `${title}: column ${grid.x + 1}, row ${grid.y + 1}, ${grid.w} columns wide, ${grid.h} rows high`;
}

/** The twelve columns, named for their guides. */
const columnNames = Array.from({ length: 12 }, (_, index) => `column-${index + 1}`);

/**
 * The faint columns behind the frames.
 *
 * @returns The guides.
 */
function ColumnGuides() {
  return (
    <div className={styles.guides} aria-hidden="true">
      {columnNames.map((name) => (
        <span key={name} />
      ))}
    </div>
  );
}

/**
 * The frames' controls besides the pointer: the keyboard, each change said aloud, and the quick
 * actions.
 *
 * @param props - The layout, the titles and the change callback.
 * @returns The key handler, the quick action handler, and the last change in words.
 */
function useFrameControls(props: LayoutOverlayProps) {
  const [said, setSaid] = useState('');
  const onKey = (event: KeyboardEvent, panel: LayoutPanel) => {
    const next = keyed(event, props.layout, panel);
    if (!next) return;
    event.preventDefault();
    props.onChange(next);
    const title = props.titles.get(panel.id) ?? panel.id;
    const after = next.panels.find((each) => each.id === panel.id);
    setSaid(
      after?.hidden
        ? `${title} hidden. Show it from Hidden panels.`
        : placeWords(title, after?.grid ?? panel.grid),
    );
  };
  const onAction = (panel: LayoutPanel, action: QuickAction) =>
    props.onChange(quickAction(props.layout, panel.id, action));
  return { onKey, onAction, said };
}

/**
 * The edit layer: a frame per shown panel, the column guides, and the announcements.
 *
 * @param props - The layout, the titles and the change callback.
 * @returns The overlay.
 */
export function LayoutOverlay(props: LayoutOverlayProps) {
  const overlay = useRef<HTMLDivElement>(null);
  const pointer = usePointerDrag(props, overlay);
  const { onKey, onAction, said } = useFrameControls(props);
  // Reading order, so Tab goes through the frames as the eye does.
  const shown = props.layout.panels
    .filter((panel) => !panel.hidden)
    .sort((a, b) => a.grid.y - b.grid.y || a.grid.x - b.grid.x);
  return (
    <div
      ref={overlay}
      className={styles.overlay}
      onPointerMove={pointer.move}
      onPointerUp={pointer.end}
      onPointerCancel={pointer.end}
    >
      <ColumnGuides />
      {shown.map((panel) => (
        <LayoutFrame
          key={panel.id}
          panel={panel}
          title={props.titles.get(panel.id) ?? panel.id}
          active={pointer.active === panel.id}
          onStart={pointer.start}
          {...{ onKey, onAction, sections: props.sections }}
        />
      ))}
      <p className={styles.said} aria-live="polite">
        {said}
      </p>
    </div>
  );
}

/**
 * A layout after a frame's quick action.
 *
 * @param layout - The layout.
 * @param id - The panel.
 * @param action - Full width, half width, or hide.
 * @returns The layout.
 */
function quickAction(layout: DashboardLayout, id: string, action: QuickAction) {
  return action === 'hide' ? hidePanel(layout, id) : setWidth(layout, id, action);
}

/** Props of {@link LayoutFrame}. */
interface LayoutFrameProps {
  /** The panel. */
  readonly panel: LayoutPanel;
  /** Its title. */
  readonly title: string;
  /** Whether it is being dragged. */
  readonly active: boolean;
  /** Starts a drag. */
  readonly onStart: (event: PointerEvent, panel: LayoutPanel, mode: Drag['mode']) => void;
  /** Handles a key. */
  readonly onKey: (event: KeyboardEvent, panel: LayoutPanel) => void;
  /** Runs a quick action. */
  readonly onAction: (panel: LayoutPanel, action: QuickAction) => void;
  /** Where the panel can move to, when sections are arranged. */
  readonly sections?: SectionMoves | undefined;
}

/**
 * One panel's frame: its handle, dragged to move the panel and focused to use the keyboard; its
 * corner, dragged to resize it; and its ⋯ menu of quick actions, the section to move it to among
 * them while sections are arranged.
 *
 * @param props - The panel, its title, whether it is dragged, and the handlers.
 * @returns The frame.
 */
function LayoutFrame(props: LayoutFrameProps) {
  const { panel, title, active, onStart, onKey, onAction, sections } = props;
  const { w, h } = panel.grid;
  return (
    <div className={styles.frame} data-frame data-active={active} style={placeStyle(panel.grid)}>
      <button
        type="button"
        aria-roledescription="movable panel"
        aria-label={`${placeWords(title, panel.grid)}. Arrow keys move it; Shift and an arrow resize it; H hides it.`}
        className={styles.handle}
        onPointerDown={(event) => onStart(event, panel, 'move')}
        onKeyDown={(event) => onKey(event, panel)}
      >
        <span className={styles.label}>{title}</span>
        <span className={styles.size} aria-hidden="true">{`${w} × ${h}`}</span>
        <span
          className={styles.resize}
          aria-hidden="true"
          onPointerDown={(event) => onStart(event, panel, 'resize')}
        />
      </button>
      <FrameMenu panel={panel} title={title} onAction={onAction} sections={sections} />
    </div>
  );
}
