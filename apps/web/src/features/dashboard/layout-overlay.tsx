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
import {
  cellsOf,
  type GridMetrics,
  hidePanel,
  movePanel,
  resizePanel,
  settle,
  setWidth,
} from './layout-edit.ts';
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

/** The sections a panel can move to, and the move. */
export interface SectionMoves {
  /** The section arranged, or `undefined` for the panels of none. */
  readonly current: string | undefined;
  /** Every section, in order, with its title. */
  readonly choices: readonly { readonly id: string; readonly title: string }[];
  /** Moves a panel to a section, or out of every one with `undefined`. */
  readonly onMove: (panelId: string, section: string | undefined) => void;
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

/** What a frame's quick actions do. */
type QuickAction = 'full' | 'half' | 'hide';

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

/** The value of the choice of no section. */
const noSection = '';

/**
 * The choice of the section a panel sits in, among the frame's quick actions.
 *
 * @param props - The panel, its title and the sections.
 * @param props.panel - The panel.
 * @param props.title - Its title.
 * @param props.sections - The sections, and the move.
 * @returns The choice.
 */
function SectionChoice({
  panel,
  title,
  sections,
}: {
  readonly panel: LayoutPanel;
  readonly title: string;
  readonly sections: SectionMoves;
}) {
  return (
    <select
      aria-label={`${title}: section`}
      value={sections.current ?? noSection}
      onChange={(event) =>
        sections.onMove(panel.id, event.target.value === noSection ? undefined : event.target.value)
      }
    >
      <option value={noSection}>No section</option>
      {sections.choices.map((choice) => (
        <option key={choice.id} value={choice.id}>
          {choice.title.trim() === '' ? 'Untitled section' : choice.title}
        </option>
      ))}
    </select>
  );
}

/**
 * One panel's frame: its handle, dragged to move the panel and focused to use the keyboard; its
 * corner, dragged to resize it; and its quick actions, the choice of its section among them while
 * sections are arranged.
 *
 * @param props - The panel, its title, whether it is dragged, and the handlers.
 * @returns The frame.
 */
function LayoutFrame(props: LayoutFrameProps) {
  const { panel, title, active, onStart, onKey, onAction, sections } = props;
  const { w, h } = panel.grid;
  return (
    <div className={styles.frame} data-active={active} style={placeStyle(panel.grid)}>
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
      <fieldset className={styles.actions} aria-label={`${title}: quick actions`}>
        <button type="button" onClick={() => onAction(panel, 'full')}>
          Full width
        </button>
        <button type="button" onClick={() => onAction(panel, 'half')}>
          Half width
        </button>
        <button type="button" onClick={() => onAction(panel, 'hide')}>
          Hide
        </button>
        {sections && <SectionChoice panel={panel} title={title} sections={sections} />}
      </fieldset>
    </div>
  );
}
