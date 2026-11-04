/**
 * A dashboard's sections while its layout is arranged: the panels of no section first, then each
 * section with its title to rename, Fold, Move up, Move down and Remove, and its panels on a grid
 * of their own with their frames; and Add a section at the end. A frame dragged onto another
 * section drops there, a folded or empty one included.
 */
import type { DashboardLayout, DashboardSpec, Panel } from '@quanthea/shared';
import { type ReactNode, useState } from 'react';
import { Button } from '../../ui/button.tsx';
import styles from './arranged-sections.module.css';
import { looseSection } from './layout-drop.ts';
import type { SectionMoves } from './layout-frame-menu.tsx';
import { LayoutOverlay } from './layout-overlay.tsx';
import {
  addSection,
  groupsOf,
  moveSection,
  moveToSection,
  removeSection,
  renameSection,
  sectionLayout,
  withPart,
} from './layout-section-edit.ts';
import panelStyles from './panels.module.css';
import { WithOverlay } from './with-overlay.tsx';

/** What the canvas draws its panels with while a dashboard's sections are arranged. */
export interface SectionArranging {
  /** The layout being edited. */
  readonly layout: DashboardLayout;
  /** Each panel's title, by id. */
  readonly titles: ReadonlyMap<string, string>;
  /** Called with each change. */
  readonly onChange: (layout: DashboardLayout) => void;
  /** A title with the values of the variables it names, as the dashboard shows it. */
  readonly fill: (title: string) => string;
}

/** Props of {@link ArrangedSections}. */
interface ArrangedSectionsProps extends SectionArranging {
  /** The spec as the layout shows it. */
  readonly spec: DashboardSpec;
  /** Draws one panel. */
  readonly card: (panel: Panel) => ReactNode;
}

/** Props of one section while arranged. */
interface ArrangedGroupProps extends ArrangedSectionsProps {
  /** The section, or `undefined` for the panels of none. */
  readonly section: string | undefined;
  /** Its place among the sections, and how many there are. */
  readonly place: { readonly index: number; readonly count: number };
  /** Whether it is folded while arranging. */
  readonly folded: boolean;
  /** Folds or unfolds it. */
  readonly onFold: () => void;
  /** Where its panels can move to. */
  readonly moves: SectionMoves;
}

/**
 * How many panels a section shows, in words.
 *
 * @param layout - The layout.
 * @param section - The section.
 * @returns Such as `3 panels`.
 */
function countWords(layout: DashboardLayout, section: string | undefined): string {
  const count = sectionLayout(layout, section).panels.filter((entry) => !entry.hidden).length;
  return count === 1 ? '1 panel' : `${count} panels`;
}

/**
 * A section's fold and title to rename, with its panel count while folded.
 *
 * @param props - The section and the layout.
 * @returns The title.
 */
function SectionName({ layout, onChange, section, folded, onFold }: ArrangedGroupProps) {
  const id = section ?? '';
  const title = layout.sections?.find((each) => each.id === id)?.title ?? '';
  return (
    <>
      <button
        type="button"
        className={styles.fold}
        aria-expanded={!folded}
        aria-label={folded ? 'Unfold the section' : 'Fold the section'}
        onClick={onFold}
      />
      <input
        className={styles.title}
        aria-label="Section title"
        aria-invalid={title.trim() === '' || undefined}
        placeholder="Name the section"
        value={title}
        onChange={(event) => onChange(renameSection(layout, id, event.target.value))}
      />
      {folded && <span className={styles.count}>{countWords(layout, section)}</span>}
    </>
  );
}

/**
 * A section's head: its name, Move up, Move down and Remove.
 *
 * @param props - The section and the layout.
 * @returns The head.
 */
function SectionHead(props: ArrangedGroupProps) {
  const { layout, onChange, place } = props;
  const id = props.section ?? '';
  return (
    <div className={styles.head}>
      <SectionName {...props} />
      <Button
        size="small"
        disabled={place.index === 0}
        onClick={() => onChange(moveSection(layout, id, -1))}
      >
        Move up
      </Button>
      <Button
        size="small"
        disabled={place.index === place.count - 1}
        onClick={() => onChange(moveSection(layout, id, 1))}
      >
        Move down
      </Button>
      <Button size="small" onClick={() => onChange(removeSection(layout, id))}>
        Remove
      </Button>
    </div>
  );
}

/**
 * The panels of one section on their grid, with their frames, or a note while it holds none.
 *
 * @param props - The section, the layout, the spec and how to draw a panel.
 * @returns The grid.
 */
function GroupGrid(props: ArrangedGroupProps) {
  const { layout, section, spec, card } = props;
  const part = sectionLayout(layout, section);
  const shown = part.panels.filter((entry) => !entry.hidden);
  if (shown.length === 0)
    return (
      <p className={styles.empty}>
        {section === undefined
          ? 'Drop a panel here to take it out of its section.'
          : 'No panels yet. Drag one here, or use a panel’s ⋯ menu.'}
      </p>
    );
  const byId = new Map(spec.panels.map((panel) => [panel.id, panel]));
  const overlay = (
    <LayoutOverlay
      layout={part}
      titles={props.titles}
      onChange={(next) => props.onChange(withPart(layout, next))}
      sections={props.moves}
    />
  );
  return (
    <div data-drop-grid>
      <WithOverlay overlay={overlay}>
        <div className={panelStyles.grid}>
          {shown.map((entry) => {
            const panel = byId.get(entry.id);
            return panel && card({ ...panel, grid: entry.grid });
          })}
        </div>
      </WithOverlay>
    </div>
  );
}

/**
 * One section as it is arranged: its head, and its grid unless folded.
 *
 * @param props - The section and what it is drawn with.
 * @param props.over - Whether a dragged panel is over it.
 * @returns The section.
 */
function ArrangedGroup(props: ArrangedGroupProps & { readonly over: boolean }) {
  const { section, place, folded, over } = props;
  return (
    <section
      className={styles.section}
      data-drop-section={section ?? looseSection}
      data-over={over || undefined}
    >
      {section === undefined ? (
        place.count > 0 && <p className={styles.loose}>Not in a section</p>
      ) : (
        <SectionHead {...props} />
      )}
      {!folded && <GroupGrid {...props} />}
    </section>
  );
}

/**
 * The sections being arranged, which ones are folded, and which one a drag is over.
 *
 * @param props - The layout, the change callback and how titles are filled.
 * @returns The folded sections and their toggle, the section dragged over, and the moves of a
 *   section's panels.
 */
function useArrangedGroups(props: ArrangedSectionsProps) {
  const { layout, onChange, fill } = props;
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const [over, setOver] = useState<string | null>(null);
  const toggle = (id: string) =>
    setFolded((now) => {
      const next = new Set(now);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const choices = (layout.sections ?? []).map(({ id, title }) => ({ id, title: fill(title) }));
  const moves = (section: string | undefined): SectionMoves => ({
    current: section,
    choices,
    onMove: (panelId, to) => onChange(moveToSection(layout, panelId, to)),
    onDrop: (panelId, to, at) => onChange(moveToSection(layout, panelId, to, at)),
    onHover: (to) => setOver(to === null ? null : (to ?? looseSection)),
  });
  return { folded, toggle, over, moves };
}

/**
 * The sections of a dashboard as they are arranged.
 *
 * @param props - The layout, the titles, the change callback, the spec and how to draw a panel.
 * @returns The sections, and Add a section.
 */
export function ArrangedSections(props: ArrangedSectionsProps) {
  const groups = groupsOf(props.layout);
  const sections = groups.filter((group) => group !== undefined);
  const { folded, toggle, over, moves } = useArrangedGroups(props);
  return (
    <div className={styles.sections}>
      {groups.map((section) => (
        <ArrangedGroup
          key={section ?? looseSection}
          {...props}
          section={section}
          place={{ index: section ? sections.indexOf(section) : 0, count: sections.length }}
          folded={section !== undefined && folded.has(section)}
          onFold={() => section && toggle(section)}
          moves={moves(section)}
          over={over === (section ?? looseSection)}
        />
      ))}
      <button
        type="button"
        className={styles.add}
        onClick={() => props.onChange(addSection(props.layout))}
      >
        + Add a section
      </button>
    </div>
  );
}
