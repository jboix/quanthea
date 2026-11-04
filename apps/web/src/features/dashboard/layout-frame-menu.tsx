/**
 * A frame's actions while the layout is arranged, behind one ⋯ button so they fit the smallest
 * panel: Full width, Half width, Hide and, while a dashboard's sections are arranged, the section
 * to move the panel to.
 */
import type { LayoutPanel } from '@quanthea/shared';
import { MoreIcon } from '../../ui/icons.tsx';
import { MenuItem } from '../../ui/menu-item.tsx';
import { Popover } from '../../ui/popover.tsx';
import styles from './layout-overlay.module.css';

/** What a frame's quick actions do. */
export type QuickAction = 'full' | 'half' | 'hide';

/** The sections a panel can move to, and the moves. */
export interface SectionMoves {
  /** The section arranged, or `undefined` for the panels of none. */
  readonly current: string | undefined;
  /** Every section, in order, with its title as shown. */
  readonly choices: readonly { readonly id: string; readonly title: string }[];
  /** Moves a panel to the foot of a section, or out of every one with `undefined`. */
  readonly onMove: (panelId: string, section: string | undefined) => void;
  /** Moves a panel dropped on a section to the cell it was dropped at. */
  readonly onDrop: (
    panelId: string,
    section: string | undefined,
    at: { readonly x: number; readonly y: number } | undefined,
  ) => void;
  /** Says which other section a drag is over, or `null` for none. */
  readonly onHover: (section: string | undefined | null) => void;
}

/** Props of {@link FrameMenu}. */
interface FrameMenuProps {
  /** The panel. */
  readonly panel: LayoutPanel;
  /** Its title. */
  readonly title: string;
  /** Runs a quick action. */
  readonly onAction: (panel: LayoutPanel, action: QuickAction) => void;
  /** Where the panel can move to, when sections are arranged. */
  readonly sections?: SectionMoves | undefined;
}

/** The quick actions, with their names. */
const actions: readonly (readonly [QuickAction, string])[] = [
  ['full', 'Full width'],
  ['half', 'Half width'],
  ['hide', 'Hide'],
];

/**
 * The sections a panel can move to, the one it is in left out.
 *
 * @param props - The panel, the sections and the close callback.
 * @param props.panel - The panel.
 * @param props.sections - The sections.
 * @param props.close - Closes the menu.
 * @returns The items.
 */
function SectionItems({
  panel,
  sections,
  close,
}: {
  readonly panel: LayoutPanel;
  readonly sections: SectionMoves;
  readonly close: () => void;
}) {
  const choices = [{ id: undefined, title: 'No section' }, ...sections.choices];
  const others = choices.filter((choice) => choice.id !== sections.current);
  return (
    <>
      <p className={styles.menuHeading}>Move to</p>
      {others.map((choice) => (
        <MenuItem
          key={choice.id ?? ''}
          label={choice.title.trim() === '' ? 'Untitled section' : choice.title}
          onClick={() => {
            close();
            sections.onMove(panel.id, choice.id);
          }}
        />
      ))}
    </>
  );
}

/**
 * The ⋯ button at a frame's corner and its menu. Pressing it never starts a drag.
 *
 * @param props - The panel, its title, the action callback and the sections.
 * @returns The menu.
 */
export function FrameMenu({ panel, title, onAction, sections }: FrameMenuProps) {
  return (
    <div className={styles.menu} onPointerDown={(event) => event.stopPropagation()}>
      <Popover label={`${title}: actions`} trigger={<MoreIcon />} align="end">
        {(close) => (
          <div className={styles.menuBody}>
            {actions.map(([action, label]) => (
              <MenuItem
                key={action}
                label={label}
                onClick={() => {
                  close();
                  onAction(panel, action);
                }}
              />
            ))}
            {sections && <SectionItems panel={panel} sections={sections} close={close} />}
          </div>
        )}
      </Popover>
    </div>
  );
}
