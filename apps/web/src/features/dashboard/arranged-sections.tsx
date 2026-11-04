/**
 * A dashboard's sections while its layout is arranged: each section with its title to rename, its
 * order and Remove, and its panels on a grid of their own with their frames; the panels of no
 * section first; and Add a section at the end.
 */
import type { DashboardLayout, DashboardSpec, Panel } from '@quanthea/shared';
import type { ReactNode } from 'react';
import { Button } from '../../ui/button.tsx';
import styles from './arranged-sections.module.css';
import { LayoutOverlay, type SectionMoves } from './layout-overlay.tsx';
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
}

/**
 * A section's title to rename, Move up, Move down and Remove.
 *
 * @param props - The section and the layout.
 * @returns The head.
 */
function SectionHead({ layout, onChange, section, place }: ArrangedGroupProps) {
  const id = section ?? '';
  const title = layout.sections?.find((each) => each.id === id)?.title ?? '';
  const blank = title.trim() === '';
  return (
    <div className={styles.head}>
      <input
        className={styles.title}
        aria-label="Section title"
        aria-invalid={blank || undefined}
        placeholder="Name the section"
        value={title}
        onChange={(event) => onChange(renameSection(layout, id, event.target.value))}
      />
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
    return <p className={styles.empty}>No panels yet. Move one here with its Section choice.</p>;
  const byId = new Map(spec.panels.map((panel) => [panel.id, panel]));
  const moves: SectionMoves = {
    current: section,
    choices: layout.sections ?? [],
    onMove: (panelId, to) => props.onChange(moveToSection(layout, panelId, to)),
  };
  const overlay = (
    <LayoutOverlay
      layout={part}
      titles={props.titles}
      onChange={(next) => props.onChange(withPart(layout, next))}
      sections={moves}
    />
  );
  return (
    <WithOverlay overlay={overlay}>
      <div className={panelStyles.grid}>
        {shown.map((entry) => {
          const panel = byId.get(entry.id);
          return panel && card({ ...panel, grid: entry.grid });
        })}
      </div>
    </WithOverlay>
  );
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
  return (
    <div className={styles.sections}>
      {groups.map((section) => (
        <section key={section ?? ''} className={styles.section}>
          {section === undefined ? (
            sections.length > 0 && <p className={styles.loose}>Not in a section</p>
          ) : (
            <SectionHead
              {...props}
              section={section}
              place={{ index: sections.indexOf(section), count: sections.length }}
            />
          )}
          <GroupGrid {...props} section={section} place={{ index: 0, count: 0 }} />
        </section>
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
