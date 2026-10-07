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
import { cellsOf, type GridMetrics, movePanel, resizePanel, settle } from './layout-edit.ts';
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
 * Dragging frames with a pointer: the overlay captures the pointer, so a drag goes on outside the
 * frame it started on.
 *
 * @param props - The layout and the change callback.
 * @param overlay - The overlay element.
 * @returns The handlers, and the panel being dragged.
 */
function usePointerDrag(props: LayoutOverlayProps, overlay: RefObject<HTMLDivElement | null>) {
  const drag = useRef<Drag | null>(null);
  const latest = useRef(props.layout);
  latest.current = props.layout;
  const [active, setActive] = useState<string | null>(null);
  const start = (event: PointerEvent, panel: LayoutPanel, mode: Drag['mode']) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    overlay.current?.setPointerCapture(event.pointerId);
    drag.current = {
      id: panel.id,
      mode,
      x: event.clientX,
      y: event.clientY,
      base: latest.current,
      grid: panel.grid,
    };
    setActive(panel.id);
  };
  const move = (event: PointerEvent) => {
    if (drag.current) props.onChange(dragged(drag.current, event, overlay.current));
  };
  const end = () => {
    if (!drag.current) return;
    drag.current = null;
    setActive(null);
    props.onChange(settle(latest.current));
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
 * Moves or resizes the focused panel by one cell with the arrow keys, Shift to resize.
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
 * Moving and resizing the focused frame with the keyboard, each change said aloud.
 *
 * @param props - The layout, the titles and the change callback.
 * @returns The key handler, and the last change in words.
 */
function useKeyboardArrange(props: LayoutOverlayProps) {
  const [said, setSaid] = useState('');
  const onKey = (event: KeyboardEvent, panel: LayoutPanel) => {
    const next = keyed(event, props.layout, panel);
    if (!next) return;
    event.preventDefault();
    props.onChange(next);
    const grid = next.panels.find((each) => each.id === panel.id)?.grid ?? panel.grid;
    setSaid(placeWords(props.titles.get(panel.id) ?? panel.id, grid));
  };
  return { onKey, said };
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
  const { onKey, said } = useKeyboardArrange(props);
  return (
    <div
      ref={overlay}
      className={styles.overlay}
      onPointerMove={pointer.move}
      onPointerUp={pointer.end}
      onPointerCancel={pointer.end}
    >
      <ColumnGuides />
      {props.layout.panels
        .filter((panel) => !panel.hidden)
        // Reading order, so Tab goes through the frames as the eye does.
        .sort((a, b) => a.grid.y - b.grid.y || a.grid.x - b.grid.x)
        .map((panel) => (
          <LayoutFrame
            key={panel.id}
            panel={panel}
            title={props.titles.get(panel.id) ?? panel.id}
            active={pointer.active === panel.id}
            onStart={pointer.start}
            onKey={onKey}
          />
        ))}
      <p className={styles.said} aria-live="polite">
        {said}
      </p>
    </div>
  );
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
}

/**
 * One panel's frame: dragged to move it, its corner dragged to resize it, focused to use the
 * keyboard.
 *
 * @param props - The panel, its title, whether it is dragged, and the handlers.
 * @returns The frame.
 */
function LayoutFrame({ panel, title, active, onStart, onKey }: LayoutFrameProps) {
  const { w, h } = panel.grid;
  return (
    <button
      type="button"
      aria-roledescription="movable panel"
      aria-label={`${placeWords(title, panel.grid)}. Arrow keys move it; Shift and an arrow resize it.`}
      className={styles.frame}
      data-active={active}
      style={placeStyle(panel.grid)}
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
  );
}
