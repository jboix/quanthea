import { bodyLanguage, type DefinitionVersion, queryLanguageNames } from '@quanthea/shared';
import { useState } from 'react';
import { SearchIcon } from '../../ui/icons.tsx';
import styles from './definitions.module.css';

/** Props of {@link DefinitionList}. */
interface DefinitionListProps {
  /** The definitions. */
  readonly definitions: readonly DefinitionVersion[];
  /** The id shown, if any. */
  readonly current: string | undefined;
  /** Shows a definition. */
  readonly onPick: (id: string) => void;
}

/**
 * Whether a definition matches what was typed in the search: its name, synonyms or meaning.
 *
 * @param version - The definition.
 * @param needle - What was typed, lower case.
 * @returns Whether it matches.
 */
function matches(version: DefinitionVersion, needle: string): boolean {
  const { name, synonyms, meaning, id } = version.definition;
  return [name, id, meaning, ...synonyms].some((text) => text.toLowerCase().includes(needle));
}

/**
 * Where a definition is checked, as short marks: each language, or "meaning only".
 *
 * @param props - The definition.
 * @param props.version - The definition's latest version.
 * @returns The marks.
 */
export function CheckedMarks({ version }: { readonly version: DefinitionVersion }) {
  const languages = version.definition.bodies.map((body) => queryLanguageNames[bodyLanguage(body)]);
  if (languages.length === 0) return <span className={styles.markPlain}>meaning only</span>;
  return (
    <>
      {languages.map((language) => (
        <span key={language} className={styles.markChecked}>
          ✓ {language}
        </span>
      ))}
    </>
  );
}

/**
 * The list of definitions, with a search over names, synonyms and meanings.
 *
 * @param props - The definitions, the one shown, and the pick callback.
 * @returns The list.
 */
export function DefinitionList({ definitions, current, onPick }: DefinitionListProps) {
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const shown = definitions
    .filter((version) => needle === '' || matches(version, needle))
    .toSorted((a, b) => a.definition.name.localeCompare(b.definition.name));
  return (
    <nav className={styles.side} aria-label="Definitions">
      <label className={styles.search}>
        <SearchIcon />
        <input
          type="search"
          placeholder={`Search ${definitions.length} definitions`}
          aria-label="Search the definitions"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <ul className={styles.list}>
        {shown.map((version) => (
          <li key={version.definition.id}>
            <button
              type="button"
              className={styles.row}
              aria-current={version.definition.id === current}
              onClick={() => onPick(version.definition.id)}
            >
              <span className={styles.rowName}>{version.definition.name}</span>
              <span className={styles.rowMeaning}>{version.definition.meaning}</span>
              <span className={styles.marks}>
                <CheckedMarks version={version} />
              </span>
            </button>
          </li>
        ))}
      </ul>
      {shown.length === 0 && <p className={styles.noMatch}>No definition matches “{query}”.</p>}
    </nav>
  );
}
