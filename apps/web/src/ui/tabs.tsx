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
}

/** How far each arrow key moves the selection. */
const keySteps: Readonly<Record<string, number>> = { ArrowLeft: -1, ArrowRight: 1 };

/**
 * A tab list with an underline on the selected tab. Left and right arrows move the selection;
 * only the selected tab is in the tab order. The caller renders the panel.
 *
 * @param props - Label, tabs, selection and the selection callback.
 * @returns The tab list.
 */
export function Tabs({ label, tabs, selected, onSelect }: TabsProps) {
  const idPrefix = useId();
  const selectByKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step = keySteps[event.key];
    if (step === undefined) return;
    const current = tabs.findIndex((tab) => tab.id === selected);
    const next = tabs[(current + step + tabs.length) % tabs.length];
    if (!next) return;
    onSelect(next.id);
    document.getElementById(`${idPrefix}-${next.id}`)?.focus();
  };
  return (
    <div role="tablist" aria-label={label} className={styles.list} onKeyDown={selectByKey}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          id={`${idPrefix}-${tab.id}`}
          type="button"
          role="tab"
          aria-selected={tab.id === selected}
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
