import type { ConnectorKindInfo } from '@querent/shared';
import { type KeyboardEvent, useId, useState } from 'react';
import { SearchIcon } from '../../ui/icons.tsx';
import { KindIcon } from './kind-icon.tsx';
import styles from './kind-picker.module.css';
import { matchingKinds, pluginLabel } from './kinds.ts';

/** Props of {@link KindPicker}. */
interface KindPickerProps {
  /** The kinds on offer, in order. */
  readonly kinds: readonly ConnectorKindInfo[];
  /** The picked kind's identifier. */
  readonly value: string;
  /** Called with the identifier of the kind the admin picks. */
  readonly onChange: (kind: string) => void;
}

/**
 * Keeps Enter in the search from submitting the connector form.
 *
 * @param event - The key event.
 */
function holdEnter(event: KeyboardEvent<HTMLInputElement>): void {
  if (event.key === 'Enter') event.preventDefault();
}

/**
 * The search over the kinds.
 *
 * @param props - The text and its setter.
 * @param props.value - The text.
 * @param props.onChange - Called with the new text.
 * @returns The search field.
 */
function KindSearch({
  value,
  onChange,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  return (
    <search className={styles.search}>
      <span className={styles.searchIcon}>
        <SearchIcon />
      </span>
      <input
        type="search"
        aria-label="Search the kinds"
        className={styles.searchInput}
        placeholder="Search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={holdEnter}
      />
    </search>
  );
}

/**
 * The kinds as a grid of logos and names, with a search that narrows them. When the search hides
 * the picked kind, the first match is picked, so the settings below always belong to a kind in
 * view.
 *
 * @param props - The kinds, the picked one and the change callback.
 * @returns The picker: native radio buttons in a fieldset.
 */
export function KindPicker({ kinds, value, onChange }: KindPickerProps) {
  const name = useId();
  const [search, setSearch] = useState('');
  const shown = matchingKinds(kinds, search);
  const type = (text: string) => {
    setSearch(text);
    const matches = matchingKinds(kinds, text);
    const first = matches[0];
    if (first && !matches.some((kind) => kind.kind === value)) onChange(first.kind);
  };
  return (
    <fieldset className={styles.picker}>
      <legend className={styles.legend}>Kind</legend>
      <KindSearch value={search} onChange={type} />
      {shown.length === 0 && <p className={styles.none}>No kind matches “{search.trim()}”.</p>}
      <div className={styles.grid}>
        {shown.map((kind) => (
          <label key={kind.kind} className={styles.tile}>
            <input
              type="radio"
              name={name}
              className={styles.input}
              checked={kind.kind === value}
              onChange={() => onChange(kind.kind)}
            />
            <KindIcon kind={kind.kind} info={kind} size={28} />
            <span className={styles.label}>
              <span className={styles.name}>{kind.displayName}</span>
              {kind.plugin && (
                <span className={styles.origin} title={kind.plugin.name}>
                  {pluginLabel(kind)}
                </span>
              )}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
