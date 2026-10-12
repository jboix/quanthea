import type { ObjectVisibility } from '@quanthea/shared';
import { useState } from 'react';
import { Input } from '../../ui/input.tsx';
import styles from './objects.module.css';
import {
  filteredObjects,
  isShown,
  lockOf,
  objectsNoun,
  type SchemaObject,
  shownSummary,
  withObject,
  withObjects,
} from './shown-objects.ts';

/** The most rows the checklist draws; the filter reaches the rest. */
const maxRows = 200;

/** From this many objects the checklist offers a filter. */
const filterFrom = 8;

/** Props of the checklist and its parts. */
interface ChecklistProps {
  /** The objects the schema found. */
  readonly objects: readonly SchemaObject[];
  /** The visibility being edited. */
  readonly visibility: ObjectVisibility;
  /** Replaces the visibility. */
  readonly onChange: (visibility: ObjectVisibility) => void;
}

/**
 * What a row says after the name: why its checkbox is fixed, or the object's size.
 *
 * @param visibility - The visibility being edited.
 * @param object - The object.
 * @returns Such as `system`, `by logs-*` or `8,200 rows`; empty when there is nothing to say.
 */
function rowNote(visibility: ObjectVisibility, object: SchemaObject): string {
  const lock = lockOf(visibility, object);
  if (lock?.by === 'system') return 'system';
  if (lock?.by === 'pattern') return `by ${lock.pattern}`;
  if (object.system) return 'system';
  return object.rows === undefined ? '' : `${object.rows.toLocaleString('en')} rows`;
}

/** Props of {@link ObjectRow}. */
interface ObjectRowProps {
  /** The object. */
  readonly object: SchemaObject;
  /** The visibility being edited. */
  readonly visibility: ObjectVisibility;
  /** Called with whether the object is ticked now. */
  readonly onToggle: (shown: boolean) => void;
}

/**
 * One object of the checklist: ticked when the connector shows it. The checkbox is fixed while
 * the system switch or a pattern decides for it.
 *
 * @param props - The object, the visibility and the toggle callback.
 * @returns The row.
 */
function ObjectRow({ object, visibility, onToggle }: ObjectRowProps) {
  const shown = isShown(visibility, object);
  return (
    <li>
      <label className={styles.row} data-shown={shown}>
        <input
          type="checkbox"
          className={styles.box}
          checked={shown}
          disabled={lockOf(visibility, object) !== undefined}
          onChange={(event) => onToggle(event.target.checked)}
        />
        <span className={styles.rowName}>{object.name}</span>
        <span className={styles.rowNote}>{rowNote(visibility, object)}</span>
      </label>
    </li>
  );
}

/** Props of {@link ChecklistHead}. */
interface ChecklistHeadProps extends ChecklistProps {
  /** The objects the filter keeps. */
  readonly matching: readonly SchemaObject[];
  /** The filter text. */
  readonly filter: string;
  /** Replaces the filter text. */
  readonly setFilter: (filter: string) => void;
}

/**
 * The checklist's counts, its filter, and the buttons that tick or clear every object the filter
 * keeps and no switch or pattern fixes.
 *
 * @param props - The objects, the visibility, the filter and the callbacks.
 * @returns The header.
 */
function ChecklistHead(props: ChecklistHeadProps) {
  const { objects, visibility, onChange, matching, filter, setFilter } = props;
  const free = matching.filter((object) => lockOf(visibility, object) === undefined);
  const names = free.map((object) => object.name);
  const all = filter.trim() === '' ? 'all' : 'these';
  return (
    <div className={styles.listHead}>
      <span className={styles.summary}>{shownSummary(visibility, objects)}</span>
      <span className={styles.bulk}>
        <button type="button" onClick={() => onChange(withObjects(visibility, names, true))}>
          Tick {all}
        </button>
        <button type="button" onClick={() => onChange(withObjects(visibility, names, false))}>
          Clear {all}
        </button>
      </span>
      {objects.length >= filterFrom && (
        <Input
          label={`Filter the ${objectsNoun(objects)} by name`}
          hideLabel
          mono
          placeholder="Filter by name"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
      )}
    </div>
  );
}

/**
 * The line under the rows: how many more the filter would reach, or that nothing matches.
 *
 * @param props - The counts.
 * @param props.matching - How many objects the filter keeps.
 * @returns The line, or nothing when every match is drawn.
 */
function ChecklistFoot({ matching }: { readonly matching: number }) {
  if (matching === 0) return <p className={styles.listFoot}>No name matches the filter.</p>;
  if (matching <= maxRows) return null;
  return (
    <p className={styles.listFoot}>
      {(matching - maxRows).toLocaleString('en')} more. Filter to see them, or list a pattern below.
    </p>
  );
}

/**
 * The checklist of what the schema found: an object is ticked when the connector shows it, and
 * ticking or clearing one edits the list of names behind it.
 *
 * @param props - The objects, the visibility and the change callback.
 * @returns The checklist, or a note while the schema holds nothing.
 */
export function ObjectChecklist({ objects, visibility, onChange }: ChecklistProps) {
  const [filter, setFilter] = useState('');
  if (objects.length === 0)
    return (
      <p className={styles.empty}>
        The schema holds nothing yet. Names and patterns can be listed below all the same.
      </p>
    );
  const matching = filteredObjects(objects, filter);
  return (
    <div className={styles.checklist}>
      <ChecklistHead {...{ objects, visibility, onChange, matching, filter, setFilter }} />
      <ul className={styles.rows} aria-label={`The ${objectsNoun(objects)} the schema found`}>
        {matching.slice(0, maxRows).map((object) => (
          <ObjectRow
            key={object.name}
            object={object}
            visibility={visibility}
            onToggle={(shown) => onChange(withObject(visibility, object.name, shown))}
          />
        ))}
      </ul>
      <ChecklistFoot matching={matching.length} />
    </div>
  );
}
