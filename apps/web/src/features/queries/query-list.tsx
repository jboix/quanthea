import {
  builderLanguages,
  type QueryLanguage,
  queryBuilders,
  queryLanguageNames,
} from '@quanthea/shared';
import type { ReactNode } from 'react';
import { Button } from '../../ui/button.tsx';
import styles from './queries.module.css';
import type { QueriesForm } from './queries-form.ts';

/** Props of {@link ListRow}. */
interface ListRowProps {
  /** The query's name. */
  readonly name: string;
  /** What is shown on the right: the language, or "off". */
  readonly note: ReactNode;
  /** Whether it is the query shown. */
  readonly current: boolean;
  /** Whether it is dimmed, as a query switched off. */
  readonly off?: boolean;
  /** Shows it. */
  readonly onSelect: () => void;
}

/**
 * One query in the list.
 *
 * @param props - The name, the note, the state and the callback.
 * @returns The row.
 */
function ListRow({ name, note, current, off = false, onSelect }: ListRowProps) {
  return (
    <li>
      <button
        type="button"
        className={styles.listRow}
        aria-current={current ? 'true' : undefined}
        data-off={off}
        onClick={onSelect}
      >
        <span className={styles.listName}>{name}</span>
        <span className={styles.listNote}>{note}</span>
      </button>
    </li>
  );
}

/**
 * The query builders of one language.
 *
 * @param props - The form, the language and its heading.
 * @param props.form - The form state.
 * @param props.language - The language.
 * @param props.heading - The heading.
 * @returns The group.
 */
function BuiltInGroup({
  form,
  language,
  heading,
}: {
  readonly form: QueriesForm;
  readonly language: QueryLanguage;
  readonly heading: string;
}) {
  const { selected, editing } = form;
  const builders = queryBuilders.filter((recipe) => recipe.language === language);
  if (builders.length === 0) return null;
  return (
    <>
      <h3 className={styles.listHeading}>{heading}</h3>
      <ul className={styles.list}>
        {builders.map((recipe) => {
          const off = form.settings.disabled.includes(recipe.id);
          const current =
            editing === null && selected.kind === 'built-in' && selected.id === recipe.id;
          return (
            <ListRow
              key={recipe.id}
              name={recipe.name}
              note={off ? 'off' : ''}
              off={off}
              current={current}
              onSelect={() => form.select({ kind: 'built-in', id: recipe.id })}
            />
          );
        })}
      </ul>
    </>
  );
}

/**
 * Every query, yours first, to pick the one shown.
 *
 * @param props - The form.
 * @param props.form - The form state.
 * @returns The list.
 */
export function QueryList({ form }: { readonly form: QueriesForm }) {
  const { selected, editing } = form;
  return (
    <nav className={styles.side} aria-label="Queries">
      <div className={styles.sideHead}>
        <h3 className={styles.listHeading}>Your queries</h3>
        <Button size="small" onClick={form.add} disabled={editing !== null}>
          Add
        </Button>
      </div>
      {form.settings.saved.length === 0 && <p className={styles.hint}>None yet.</p>}
      <ul className={styles.list}>
        {form.settings.saved.map((recipe, index) => (
          <ListRow
            key={recipe.id}
            name={recipe.name}
            note={queryLanguageNames[recipe.language]}
            current={editing === null && selected.kind === 'saved' && selected.index === index}
            onSelect={() => form.select({ kind: 'saved', index })}
          />
        ))}
      </ul>
      {builderLanguages.map((language) => (
        <BuiltInGroup
          key={language}
          form={form}
          language={language}
          heading={`Builders · ${queryLanguageNames[language]}`}
        />
      ))}
    </nav>
  );
}
