import type { QueryChoice, ThreadQueries } from '@querent/shared';
import { useState } from 'react';
import { Select } from '../../ui/select.tsx';
import styles from './query-choice.module.css';

/** The modes a new thread may start in, as the menu names them. */
const modes = [
  { value: 'default', label: 'Default queries' },
  { value: 'chosen', label: 'Choose queries…' },
  { value: 'free', label: 'Free style' },
] as const;

/**
 * The query choice of a new thread: the mode, and the queries ticked when choosing.
 *
 * @param queries - Every query; the default set starts ticked.
 * @returns The choice as the API takes it, the mode, the ticked ids, and their setters.
 */
export function useQueryChoice(queries: readonly QueryChoice[]) {
  const [mode, setMode] = useState<ThreadQueries['mode']>('default');
  const [ticked, setTicked] = useState(
    () => new Set(queries.filter((query) => query.enabled).map((query) => query.id)),
  );
  const toggle = (id: string) =>
    setTicked((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const value: ThreadQueries = mode === 'chosen' ? { mode, ids: [...ticked] } : { mode };
  return { mode, setMode, ticked, toggle, value };
}

/** A query choice. */
type Choice = ReturnType<typeof useQueryChoice>;

/**
 * The menu of query modes.
 *
 * @param props - The choice.
 * @param props.choice - What {@link useQueryChoice} returns.
 * @returns The menu.
 */
export function QueryModeMenu({ choice }: { readonly choice: Choice }) {
  return (
    <Select
      label="Queries"
      hideLabel
      compact
      title="Query builders write tested queries for the agent, for fewer tokens and fewer broken panels."
      options={modes}
      value={choice.mode}
      onChange={(event) => choice.setMode(event.target.value as ThreadQueries['mode'])}
    />
  );
}

/**
 * The queries to tick, when choosing. Free style says what it means instead.
 *
 * @param props - The queries and the choice.
 * @param props.queries - Every query.
 * @param props.choice - What {@link useQueryChoice} returns.
 * @returns The list, the note, or nothing for the default set.
 */
export function QueryPicker({
  queries,
  choice,
}: {
  readonly queries: readonly QueryChoice[];
  readonly choice: Choice;
}) {
  if (choice.mode === 'free')
    return (
      <p className={styles.note}>
        No query builders: the agent writes every query itself. More tokens, more to repair.
      </p>
    );
  if (choice.mode === 'default') return null;
  return (
    <fieldset className={styles.picker}>
      <legend className={styles.legend}>Queries this thread may use</legend>
      {queries.map((query) => (
        <label key={query.id} className={styles.query} title={query.description}>
          <input
            type="checkbox"
            checked={choice.ticked.has(query.id)}
            onChange={() => choice.toggle(query.id)}
          />
          <span>{query.name}</span>
          <span className={styles.language}>
            {query.origin === 'saved' ? `saved · ${query.language}` : query.language}
          </span>
        </label>
      ))}
    </fieldset>
  );
}
