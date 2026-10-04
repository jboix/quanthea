import { type KeyboardEvent, useId } from 'react';
import styles from './tabs.module.css';

/** One tab. */
interface Tab {
  /** A stable identifier, passed to `onSelect`. */
  readonly id: string;
  /** The visible label. */
  readonly label: string;
}

/** Props of {@link Tabs}. */
interface TabsProps {
  /** The accessible name of the tab list. */
  readonly label: string;
  /** The tabs, in order. */
  readonly tabs: readonly Tab[];
  /** The id of the selected tab. */
  readonly selected: string;
  /** Called with the id of the tab the user picks. */
  readonly onSelect: (id: string) => void;
  /**
   * Names the tabs and their panels: each tab then controls the element that
   * {@link tabPanelProps} gives the same name and tab id. Left out, the tabs control nothing.
   */
  readonly panels?: string | undefined;
}

/**
 * The id of a tab of a named tab list.
 *
 * @param panels - The tab list's `panels` name.
 * @param tabId - The tab's id.
 * @returns The tab element's id.
 */
function tabElementId(panels: string, tabId: string): string {
  return `${panels}-tab-${tabId}`;
}

/**
 * The attributes of the panel a tab controls: its role, its id and the tab that names it.
 *
 * @param panels - The tab list's `panels` name.
 * @param tabId - The selected tab's id.
 * @returns The attributes, to spread on the panel.
 */
export function tabPanelProps(panels: string, tabId: string) {
  return {
    role: 'tabpanel',
    id: `${panels}-panel-${tabId}`,
    'aria-labelledby': tabElementId(panels, tabId),
  } as const;
}

/** How far each arrow key moves the selection. */
const keySteps: Readonly<Record<string, number>> = { ArrowLeft: -1, ArrowRight: 1 };

/**
 * A tab list with an underline on the selected tab. Left and right arrows move the selection;
 * only the selected tab is in the tab order. The caller renders the panel, with
 * {@link tabPanelProps} when it names the panels.
 *
 * @param props - Label, tabs, selection and the selection callback.
 * @returns The tab list.
 */
export function Tabs({ label, tabs, selected, onSelect, panels }: TabsProps) {
  const generated = useId();
  const elementId = (tabId: string) => tabElementId(panels ?? generated, tabId);
  const selectByKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    const next = nextTab(tabs, selected, keySteps[event.key]);
    if (!next) return;
    onSelect(next.id);
    document.getElementById(elementId(next.id))?.focus();
  };
  return (
    <div role="tablist" aria-label={label} className={styles.list} onKeyDown={selectByKey}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          id={elementId(tab.id)}
          type="button"
          role="tab"
          aria-selected={tab.id === selected}
          aria-controls={
            panels && tab.id === selected ? tabPanelProps(panels, tab.id).id : undefined
          }
          tabIndex={tab.id === selected ? 0 : -1}
          className={styles.tab}
          onClick={() => onSelect(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

/**
 * The tab an arrow key moves the selection to, round the ends.
 *
 * @param tabs - The tabs.
 * @param selected - The selected tab's id.
 * @param step - How far the key moves, or `undefined` for another key.
 * @returns The tab, or `undefined` for another key.
 */
function nextTab(tabs: readonly Tab[], selected: string, step: number | undefined) {
  if (step === undefined) return undefined;
  const current = tabs.findIndex((tab) => tab.id === selected);
  return tabs[(current + step + tabs.length) % tabs.length];
}
