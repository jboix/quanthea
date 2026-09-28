import { type ReactNode, type SelectHTMLAttributes, useId } from 'react';
import styles from './field.module.css';
import { describedBy, FieldNotes } from './field-notes.tsx';

/** One choice of a {@link Select}. */
interface SelectOption {
  /** The submitted value. */
  readonly value: string;
  /** The visible text. */
  readonly label: string;
  /** The heading it sits under; options without one come first, ungrouped. */
  readonly group?: string;
}

/**
 * The options, the ungrouped ones first, then one `optgroup` per group in order of appearance.
 *
 * @param options - The options.
 * @returns The option elements.
 */
function optionElements(options: readonly SelectOption[]) {
  const element = (option: SelectOption) => (
    <option key={option.value} value={option.value}>
      {option.label}
    </option>
  );
  const groups = [...new Set(options.flatMap((option) => option.group ?? []))];
  return [
    ...options.filter((option) => option.group === undefined).map(element),
    ...groups.map((group) => (
      <optgroup key={group} label={group}>
        {options.filter((option) => option.group === group).map(element)}
      </optgroup>
    )),
  ];
}

/** Props of {@link Select}. */
interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id' | 'children'> {
  /** The visible label. */
  readonly label: ReactNode;
  /** The choices, in order. */
  readonly options: readonly SelectOption[];
  /** Sets the options in IBM Plex Mono, for model names and identifiers. */
  readonly mono?: boolean;
  /** One line under the control. */
  readonly hint?: ReactNode;
  /** What is wrong with the value. It replaces the hint. */
  readonly error?: string | undefined;
  /** Keeps the label for screen readers only, for selects whose purpose the layout shows. */
  readonly hideLabel?: boolean;
}

/**
 * A labelled native select.
 *
 * @param props - Label, options, font, hint, error and any native select attribute.
 * @returns The field: label, select, and the error or hint.
 */
export function Select({
  label,
  options,
  mono = false,
  hint,
  error,
  hideLabel = false,
  className,
  ...rest
}: SelectProps) {
  const selectId = useId();
  const classes = [styles.control, mono && styles.mono, className].filter(Boolean).join(' ');
  return (
    <div className={styles.field}>
      <label htmlFor={selectId} className={hideLabel ? styles.visuallyHidden : styles.label}>
        {label}
      </label>
      <select
        id={selectId}
        className={classes}
        {...describedBy(`${selectId}-notes`, hint, error)}
        {...rest}
      >
        {optionElements(options)}
      </select>
      <FieldNotes id={`${selectId}-notes`} hint={hint} error={error} />
    </div>
  );
}
