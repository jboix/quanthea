import {
  type ChangeEvent,
  Fragment,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import styles from './combobox.module.css';
import {
  type ComboboxItem,
  type ComboboxOption,
  comboboxItems,
  labelOf,
} from './combobox-items.ts';
import field from './field.module.css';
import { describedBy, FieldNotes } from './field-notes.tsx';
import { ChevronDownIcon } from './icons.tsx';
import dropdown from './select.module.css';

/** Props of {@link Combobox}. */
interface ComboboxProps {
  /** The visible label. */
  readonly label: ReactNode;
  /** The choices, in order. */
  readonly options: readonly ComboboxOption[];
  /** The value chosen. */
  readonly value: string;
  /** Called with the value chosen. */
  readonly onChange: (value: string) => void;
  /** Whether any typed text may be chosen, not only an option. */
  readonly allowCustom?: boolean;
  /** Shown while the field is empty. */
  readonly placeholder?: string;
  /** Sets the text in IBM Plex Mono, for model names and identifiers. */
  readonly mono?: boolean;
  /** Keeps the label for screen readers only. */
  readonly hideLabel?: boolean;
  /** One line under the control. */
  readonly hint?: ReactNode;
  /** What is wrong with the value. It replaces the hint. */
  readonly error?: string | undefined;
}

/**
 * The state of a searchable dropdown: open or not, what was typed, and the highlighted item.
 * Arrows move, Enter chooses, Escape and leaving the field drop what was typed.
 *
 * @param props - The options, the value, the change callback and whether any text is allowed.
 * @returns The state, the items and the handlers.
 */
function useCombobox({ options, value, onChange, allowCustom = false }: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const items = comboboxItems(options, query ?? '', allowCustom);
  const close = () => {
    setOpen(false);
    setQuery(null);
  };
  const show = () => {
    setOpen(true);
    setActive(
      Math.max(
        0,
        items.findIndex((item) => item.value === value),
      ),
    );
  };
  const type = (text: string) => {
    setQuery(text);
    setOpen(true);
    setActive(0);
  };
  const choose = (item: ComboboxItem | undefined) => {
    if (item) onChange(item.value);
    close();
  };
  const current = Math.min(active, items.length - 1);
  const state = { open, query, items, current, setActive, show, type, close, choose };
  return { ...state, keys: keyActions(state) };
}

/**
 * What each key does: arrows move or open, Enter chooses or opens, Escape closes.
 *
 * @param state - The open state, the items, the highlighted one and the actions.
 * @returns The action of each key, or `undefined` to let the key through.
 */
function keyActions(state: {
  readonly open: boolean;
  readonly items: readonly ComboboxItem[];
  readonly current: number;
  readonly setActive: (index: number) => void;
  readonly show: () => void;
  readonly close: () => void;
  readonly choose: (item: ComboboxItem | undefined) => void;
}): Readonly<Record<string, (() => void) | undefined>> {
  const { open, items, current, setActive, show, close, choose } = state;
  return {
    ArrowDown: open ? () => setActive(Math.min(current + 1, items.length - 1)) : show,
    ArrowUp: () => setActive(Math.max(current - 1, 0)),
    Enter: open ? () => choose(items[current]) : show,
    Escape: open ? close : undefined,
  };
}

/** The state {@link useCombobox} returns. */
type ComboboxState = ReturnType<typeof useCombobox>;

/**
 * The id of an item, for `aria-activedescendant`.
 *
 * @param listId - The list's id.
 * @param index - The item's place.
 * @returns The id.
 */
function itemId(listId: string, index: number): string {
  return `${listId}-${index}`;
}

/**
 * The heading above an item, when it starts a group.
 *
 * @param items - The items.
 * @param index - The item's place.
 * @returns The heading, or nothing.
 */
function headingAt(items: readonly ComboboxItem[], index: number) {
  const group = items[index]?.group;
  if (group === undefined || items[index - 1]?.group === group) return null;
  return (
    <div role="presentation" className={styles.group}>
      {group}
    </div>
  );
}

/** Props of {@link ComboboxRow}. */
interface ComboboxRowProps {
  /** The row's id, for `aria-activedescendant`. */
  readonly id: string;
  /** The item. */
  readonly item: ComboboxItem;
  /** Whether it is the value chosen. */
  readonly selected: boolean;
  /** Whether it is highlighted. */
  readonly active: boolean;
  /** Called when the pointer moves onto it. */
  readonly onHover: () => void;
  /** Called when it is picked. */
  readonly onChoose: () => void;
}

/**
 * One item of the list. Pressing on it chooses it without taking the focus from the field.
 *
 * @param props - The item, its state and its callbacks.
 * @returns The row.
 */
function ComboboxRow({ id, item, selected, active, onHover, onChoose }: ComboboxRowProps) {
  return (
    <div
      id={id}
      role="option"
      tabIndex={-1}
      aria-selected={selected}
      data-active={active}
      className={item.custom ? `${styles.option} ${styles.custom}` : styles.option}
      onMouseEnter={onHover}
      onMouseDown={(event) => {
        event.preventDefault();
        onChoose();
      }}
    >
      {item.label}
    </div>
  );
}

/**
 * The open list: the matching items under their group headings, the highlighted one in view.
 *
 * @param props - The list's id, the state and the value chosen.
 * @param props.listId - The list's id.
 * @param props.state - What {@link useCombobox} returns.
 * @param props.value - The value chosen.
 * @param props.mono - Whether the items are in IBM Plex Mono, like the field.
 * @returns The list.
 */
function ComboboxList({
  listId,
  state,
  value,
  mono,
}: {
  readonly listId: string;
  readonly state: ComboboxState;
  readonly value: string;
  readonly mono: boolean;
}) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  });
  return (
    <div
      id={listId}
      ref={list}
      role="listbox"
      className={mono ? `${styles.list} ${field.mono}` : styles.list}
    >
      {state.items.length === 0 && (
        <div role="presentation" className={styles.empty}>
          No match
        </div>
      )}
      {state.items.map((item, index) => (
        <Fragment key={`${item.custom ? '+' : '='}${item.value}`}>
          {headingAt(state.items, index)}
          <ComboboxRow
            id={itemId(listId, index)}
            item={item}
            selected={!item.custom && item.value === value}
            active={index === state.current}
            onHover={() => state.setActive(index)}
            onChoose={() => state.choose(item)}
          />
        </Fragment>
      ))}
    </div>
  );
}

/**
 * The text field's handlers: typing filters, keys move and choose, leaving drops the typing.
 *
 * @param state - What {@link useCombobox} returns.
 * @returns The handlers.
 */
function inputHandlers(state: ComboboxState) {
  return {
    onChange: (event: ChangeEvent<HTMLInputElement>) => state.type(event.target.value),
    onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => {
      const action = state.keys[event.key];
      if (!action) return;
      event.preventDefault();
      action();
    },
    onFocus: (event: { target: HTMLInputElement }) => event.target.select(),
    onClick: () => (state.open ? undefined : state.show()),
    onBlur: state.close,
  };
}

/**
 * A searchable dropdown: type to filter the options, and with `allowCustom`, to choose any text.
 *
 * @param props - Label, options, value, change callback, and the field's look and notes.
 * @returns The field: label, text field with its list, and the error or hint.
 */
export function Combobox(props: ComboboxProps) {
  const inputId = useId();
  const listId = `${inputId}-list`;
  const state = useCombobox(props);
  const { mono = false, hideLabel = false, hint, error } = props;
  const text = state.query ?? labelOf(props.options, props.value);
  return (
    <div className={field.field}>
      <label htmlFor={inputId} className={hideLabel ? field.visuallyHidden : field.label}>
        {props.label}
      </label>
      <div className={styles.box}>
        <input
          id={inputId}
          role="combobox"
          aria-expanded={state.open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            state.open && state.current >= 0 ? itemId(listId, state.current) : undefined
          }
          className={[field.control, mono && field.mono].filter(Boolean).join(' ')}
          value={text}
          placeholder={props.placeholder}
          autoComplete="off"
          spellCheck={false}
          {...describedBy(`${inputId}-notes`, hint, error)}
          {...inputHandlers(state)}
        />
        <span className={dropdown.chevron}>
          <ChevronDownIcon />
        </span>
        {state.open && (
          <ComboboxList listId={listId} state={state} value={props.value} mono={mono} />
        )}
      </div>
      <FieldNotes id={`${inputId}-notes`} hint={hint} error={error} />
    </div>
  );
}
