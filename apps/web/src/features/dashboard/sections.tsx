import {
  type DashboardSpec,
  filledTitle,
  type Panel,
  type Section,
  sectionGroups,
} from '@quanthea/shared';
import { useCallback, useMemo, useState } from 'react';
import type { RunTarget } from './panel-card.tsx';
import { SpacedGrid } from './panel-grid.tsx';
import { type CardDrawer, FrozenCopies, SectionCopies } from './section-copies.tsx';
import styles from './sections.module.css';
import { useTitleValues } from './title-values.ts';

/** Which sections a viewer folded, and how to fold or unfold one. */
export interface Folding {
  /** The ids of the folded sections. */
  readonly folded: ReadonlySet<string>;
  /** Folds an unfolded section, or unfolds a folded one. */
  readonly toggle: (id: string) => void;
  /** The spec with only the panels drawn: those of no section and of unfolded sections. */
  readonly shown: DashboardSpec;
}

/**
 * The sections a viewer folded, starting with those the spec folds. The choice stays with the
 * viewer, for as long as the page is open.
 *
 * @param spec - The spec.
 * @returns Which sections are folded, how to toggle one, and the panels drawn.
 */
export function useFolding(spec: DashboardSpec): Folding {
  const [folded, setFolded] = useState<ReadonlySet<string>>(
    () => new Set((spec.sections ?? []).filter((each) => each.folded).map((each) => each.id)),
  );
  const toggle = useCallback((id: string) => {
    setFolded((now) => {
      const next = new Set(now);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);
  const shown = useMemo(() => {
    const drawn = sectionGroups(spec).filter(({ section }) => !section || !folded.has(section.id));
    return { ...spec, panels: drawn.flatMap((group) => group.panels) };
  }, [spec, folded]);
  return { folded, toggle, shown };
}

/**
 * Panels moved up so the first of them starts on the grid's first row, as a section draws them.
 *
 * @param panels - The panels of one section.
 * @returns The panels, each the same distance below the first.
 */
function rebased(panels: readonly Panel[]): Panel[] {
  const top = Math.min(...panels.map((panel) => panel.grid.y));
  return panels.map((panel) => ({ ...panel, grid: { ...panel.grid, y: panel.grid.y - top } }));
}

/** Props of {@link SectionTitle}. */
interface SectionTitleProps {
  /** The section. */
  readonly section: Section;
  /** The spec, for the variables the title names. */
  readonly spec: DashboardSpec;
  /** The page's run target, for the choices and the computed values; none in a snapshot. */
  readonly target: RunTarget | undefined;
  /** Whether it is folded. */
  readonly folded: boolean;
  /** How many panels it holds, said while it is folded. */
  readonly count: number;
  /** Folds or unfolds it. */
  readonly onToggle: () => void;
}

/**
 * A section's title, with the values of the variables it names, which folds and unfolds it.
 *
 * @param props - The section, the spec, the run target, whether it is folded, its panel count,
 *   and the toggle.
 * @returns The title.
 */
function SectionTitle({ section, spec, target, folded, count, onToggle }: SectionTitleProps) {
  const values = useTitleValues(section.title, spec, target);
  return (
    <h2 className={styles.title}>
      <button type="button" className={styles.toggle} aria-expanded={!folded} onClick={onToggle}>
        <span className={styles.chevron} aria-hidden="true" />
        <span className={styles.name}>{filledTitle(section.title, spec.variables, values)}</span>
        {folded && (
          <span className={styles.count}>{count === 1 ? '1 panel' : `${count} panels`}</span>
        )}
      </button>
    </h2>
  );
}

/**
 * The panels in their sections: the panels of no section on the grid, then each section's title
 * and, unfolded, its panels on a grid of their own. A section with no panel is not drawn. Without
 * sections, it is the one grid.
 *
 * A repeated section draws a copy for each value chosen when the page runs its panels, and for
 * each value a snapshot froze.
 *
 * @param props - The spec, the folding, how to draw a panel, and where copies come from.
 * @param props.spec - The spec.
 * @param props.folding - Which sections are folded, and the toggle.
 * @param props.card - Draws one panel.
 * @param props.target - The page's run target, when the page runs the copies.
 * @param props.frozen - The keys of a snapshot's runs, when it froze them.
 * @returns The sections.
 */
export function SectionedGrid({
  spec,
  folding,
  card,
  target,
  frozen,
}: {
  readonly spec: DashboardSpec;
  readonly folding: Folding;
  readonly card: CardDrawer;
  readonly target?: RunTarget | undefined;
  readonly frozen?: readonly string[] | undefined;
}) {
  const groups = useMemo(
    () =>
      sectionGroups(spec)
        .filter((group) => group.panels.length > 0)
        .map((group) => ({ ...group, panels: rebased(group.panels) })),
    [spec],
  );
  const drawn = groups.map(({ section, panels }) => {
    const folded = section !== undefined && folding.folded.has(section.id);
    return (
      <section key={section?.id ?? ''} className={styles.section} data-folded={folded}>
        {section && (
          <SectionTitle
            {...{ section, spec, target, folded }}
            count={panels.length}
            onToggle={() => folding.toggle(section.id)}
          />
        )}
        {!folded && <SectionBody {...{ spec, section, panels, card, target, frozen }} />}
      </section>
    );
  });
  return <div className={styles.sections}>{drawn}</div>;
}

/**
 * The panels of one section: on the grid, or in a copy for each value when it repeats.
 *
 * @param props - The spec, the section, its panels, the drawer and the page's run target.
 * @param props.spec - The spec.
 * @param props.section - The section, or `undefined` for the panels of none.
 * @param props.panels - Its panels.
 * @param props.card - Draws one panel.
 * @param props.target - The page's run target, when copies run.
 * @param props.frozen - The keys of a snapshot's runs, when it froze the copies.
 * @returns The panels.
 */
function SectionBody({
  spec,
  section,
  panels,
  card,
  target,
  frozen,
}: {
  readonly spec: DashboardSpec;
  readonly section: Section | undefined;
  readonly panels: readonly Panel[];
  readonly card: CardDrawer;
  readonly target: RunTarget | undefined;
  readonly frozen: readonly string[] | undefined;
}) {
  if (section?.repeat !== undefined && target)
    return <SectionCopies {...{ spec, section, panels, target, card }} />;
  if (section?.repeat !== undefined && frozen)
    return <FrozenCopies {...{ spec, section, panels, frozen, card }} />;
  return <SpacedGrid panels={panels} card={card} />;
}
