import {
  allValue,
  isMultiValue,
  labelOfValue,
  maxTextValueLength,
  offersAll,
  optionValues,
  type Variable,
} from '@quanthea/shared';
import { useRef, useState } from 'react';
import { useFetcher } from 'react-router';
import type { Loaded } from './data.ts';
import styles from './variables-bar.module.css';

/** Props of the variable chips. */
interface ChipProps {
  /** The variable. */
  readonly variable: Variable;
  /** Its current value. */
  readonly value: string | readonly string[];
  /** Called with a new value; an empty list goes back to the default. */
  readonly onChange: (value: string | readonly string[]) => void;
  /** Where its options load from, for a query-backed variable. */
  readonly optionsUrl: string;
}

/**
 * The value as the chip shows it, each value by its label when its option has one.
 *
 * @param value - One value or several.
 * @param variable - The variable, for the labels of its options.
 * @returns Such as `prod`, `All` or `a, b`.
 */
export function shown(value: string | readonly string[], variable?: Variable): string {
  const values = [value].flat();
  if (values.includes(allValue)) return 'All';
  const options = variable?.kind === 'custom' ? variable.options : undefined;
  const labels = values.map((each) => labelOfValue(options, each));
  return labels.length > 3
    ? `${labels.slice(0, 3).join(', ')} +${labels.length - 3}`
    : labels.join(', ');
}

/**
 * The options of a variable: listed in the spec, or loaded from its source when the menu opens.
 *
 * @param variable - The variable.
 * @param optionsUrl - Where query-backed options load from.
 * @returns The options, a message when they failed, and a function to load them.
 */
function useOptions(variable: Variable, optionsUrl: string) {
  const fetcher = useFetcher<Loaded<string[]>>();
  const loadedOptions = fetcher.data?.ok ? fetcher.data.value : [];
  const listed = 'options' in variable ? optionValues(variable.options) : loadedOptions;
  const withAll = offersAll(variable) ? [allValue, ...listed] : listed;
  const load = () => {
    if (variable.kind === 'query' && fetcher.state === 'idle') void fetcher.load(optionsUrl);
  };
  const message = fetcher.data && !fetcher.data.ok ? fetcher.data.message : undefined;
  return { options: withAll, loading: fetcher.state !== 'idle', message, load };
}

/** Props of {@link OptionMenu}. */
interface OptionMenuProps {
  /** The variable. */
  readonly variable: Variable;
  /** The chosen values. */
  readonly values: readonly string[];
  /** The options, loading state and failure. */
  readonly state: ReturnType<typeof useOptions>;
  /** Called with a picked option. */
  readonly onChoose: (option: string) => void;
}

/**
 * The menu of options.
 *
 * @param props - The variable, the chosen values, the options and the choose callback.
 * @returns The menu.
 */
function OptionMenu({ variable, values, state, onChoose }: OptionMenuProps) {
  return (
    <fieldset className={styles.menu}>
      <legend className={styles.legend}>{variable.label ?? variable.name}</legend>
      {state.loading && <p className={styles.menuNote}>Loading…</p>}
      {state.message !== undefined && <p className={styles.menuError}>{state.message}</p>}
      {state.options.map((option) => (
        <button
          key={option}
          type="button"
          className={styles.option}
          aria-pressed={values.includes(option)}
          onClick={() => onChoose(option)}
        >
          {shown(option, variable)}
        </button>
      ))}
    </fieldset>
  );
}

/**
 * A chip for a variable with options: one choice, or several with checkboxes.
 *
 * @param props - The variable, its value, the change callback and where options load from.
 * @returns The chip with its menu.
 */
export function OptionChip({ variable, value, onChange, optionsUrl }: ChipProps) {
  const details = useRef<HTMLDetailsElement>(null);
  const state = useOptions(variable, optionsUrl);
  const multi = isMultiValue(variable);
  const values = [value].flat();
  const choose = (option: string) => {
    if (!multi || option === allValue) {
      details.current?.removeAttribute('open');
      onChange(option);
      return;
    }
    const kept = values.filter((each) => each !== allValue);
    onChange(kept.includes(option) ? kept.filter((each) => each !== option) : [...kept, option]);
  };
  return (
    <details
      ref={details}
      className={styles.chip}
      onToggle={(event) => event.currentTarget.open && state.load()}
    >
      <summary className={styles.chipButton}>
        <span className={styles.chipName}>${variable.name}</span>
        {shown(value, variable)}
      </summary>
      <OptionMenu variable={variable} values={values} state={state} onChoose={choose} />
    </details>
  );
}

/**
 * A chip for a free-text variable: the value applies on Enter or when the field loses focus.
 *
 * @param props - The variable, its value and the change callback.
 * @returns The chip.
 */
export function TextChip({ variable, value, onChange }: Omit<ChipProps, 'optionsUrl'>) {
  const current = [value].flat()[0] ?? '';
  const [draft, setDraft] = useState(current);
  const apply = () => {
    if (draft !== current) onChange(draft === '' ? [] : draft);
  };
  return (
    <label className={styles.chipButton}>
      <span className={styles.chipName}>${variable.name}</span>
      <input
        className={styles.textInput}
        value={draft}
        maxLength={maxTextValueLength}
        size={Math.max(4, draft.length)}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={apply}
        onKeyDown={(event) => event.key === 'Enter' && apply()}
      />
    </label>
  );
}
