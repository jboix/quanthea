import {
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import list from './combobox.module.css';
import field from './field.module.css';
import { WarningIcon } from './icons.tsx';
import styles from './suggest-input.module.css';
import { isSuggested, movedHighlight, suggestionsFor } from './suggest-items.ts';

/** Props of {@link SuggestInput}. */
interface SuggestInputProps {
  /** The visible label. */
  readonly label: ReactNode;
  /** The names suggested while typing, in order. */
  readonly suggestions: readonly string[];
  /** The text typed. */
  readonly value: string;
  /** Called with the text as it is typed. */
  readonly onChange: (text: string) => void;
  /** Called with the name taken: a suggestion picked, or the text typed, on Enter. */
  readonly onCommit: (name: string) => void;
  /** Called on Escape with no suggestion highlighted. */
  readonly onCancel?: () => void;
  /** Whether a name is known. By default, whether it is one of the suggestions, in any case. */
  readonly isKnown?: (name: string) => boolean;
  /** What to say of a typed name that is not known. It is marked with this, and still taken. */
  readonly unknownNote?: string;
  /** Shown while the field is empty. */
  readonly placeholder?: string;
  /** Sets the text in IBM Plex Mono, for identifiers. */
  readonly mono?: boolean;
  /** Keeps the label for screen readers only. */
  readonly hideLabel?: boolean;
  /** The input element, for focusing it. */
  readonly ref?: Ref<HTMLInputElement>;
}

/**
 * The state of a suggesting input: whether its list shows, the suggestions for the text, the
 * highlighted one, and whether the text is a name it does not know.
 *
 * @param props - The suggestions, the text, the callbacks and the test of a known name.
 * @returns The state and what the keys do.
 */
function useSuggestions(props: SuggestInputProps) {
  const { suggestions, value, onChange, onCommit, onCancel } = props;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const { items, more } = suggestionsFor(suggestions, value);
  const typed = value.trim();
  const known = props.isKnown ?? ((name: string) => isSuggested(suggestions, name));
  const unknown = props.unknownNote !== undefined && typed !== '' && !known(typed);
  const current = Math.min(active, items.length - 1);
  const type = (text: string) => {
    onChange(text);
    setOpen(true);
    setActive(-1);
  };
  const commit = (name: string | undefined) => {
    if (name === undefined || name === '') return;
    setActive(-1);
    onCommit(name);
  };
  const keys: Readonly<Record<string, (() => void) | undefined>> = {
    ArrowDown: () => setActive(movedHighlight(open ? current : -1, 1, items.length)),
    ArrowUp: () => setActive(movedHighlight(current, -1, items.length)),
    Enter: () => commit(items[current] ?? typed),
    Escape: current >= 0 ? () => setActive(-1) : onCancel,
  };
  return { open, setOpen, items, more, unknown, current, setActive, type, commit, keys };
}

/** The state {@link useSuggestions} returns. */
type SuggestionState = ReturnType<typeof useSuggestions>;

/** Props of {@link SuggestionRows}. */
interface SuggestionRowsProps {
  /** The list's id. */
  readonly listId: string;
  /** What {@link useSuggestions} returns. */
  readonly state: SuggestionState;
  /** Whether the names are in IBM Plex Mono, like the field. */
  readonly mono: boolean;
  /** What to say of a name that is not known. */
  readonly unknownNote: string | undefined;
}

/**
 * The open list: the suggestions, how many more match, and the mark of a name that is not known.
 * Pressing on a suggestion takes it without taking the focus from the field.
 *
 * @param props - The list's id, the state, the font and the note.
 * @returns The list.
 */
function SuggestionRows({ listId, state, mono, unknownNote }: SuggestionRowsProps) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  });
  return (
    <div ref={box} className={mono ? `${list.list} ${field.mono}` : list.list}>
      <div id={listId} role="listbox" className={styles.rows}>
        {state.items.map((name, index) => (
          <div
            key={name}
            id={`${listId}-${index}`}
            role="option"
            tabIndex={-1}
            aria-selected={index === state.current}
            data-active={index === state.current}
            className={list.option}
            onMouseEnter={() => state.setActive(index)}
            onMouseDown={(event) => {
              event.preventDefault();
              state.commit(name);
            }}
          >
            {name}
          </div>
        ))}
      </div>
      {state.more > 0 && <div className={styles.more}>{state.more} more. Keep typing.</div>}
      {state.unknown && <UnknownNote id={`${listId}-unknown`} note={unknownNote} />}
    </div>
  );
}

/**
 * The mark of a typed name that is not known: a warning, not an error, since the name is taken
 * all the same.
 *
 * @param props - The id and the note.
 * @param props.id - The id, for the field's `aria-describedby`.
 * @param props.note - What to say.
 * @returns The line.
 */
function UnknownNote({ id, note }: { readonly id: string; readonly note: string | undefined }) {
  return (
    <div id={id} role="status" className={styles.unknown}>
      <WarningIcon />
      <span>{note}</span>
    </div>
  );
}

/**
 * The attributes that tie the text field to its list, and its handlers: typing filters, keys move
 * and take, and leaving closes the list.
 *
 * @param state - What {@link useSuggestions} returns.
 * @param listId - The list's id.
 * @param shown - Whether the list shows.
 * @returns The attributes of the input element.
 */
function inputAttributes(state: SuggestionState, listId: string, shown: boolean) {
  return {
    role: 'combobox',
    'aria-expanded': shown,
    'aria-controls': listId,
    'aria-autocomplete': 'list' as const,
    'aria-activedescendant': state.current >= 0 ? `${listId}-${state.current}` : undefined,
    'aria-describedby': shown && state.unknown ? `${listId}-unknown` : undefined,
    autoComplete: 'off',
    spellCheck: false,
    onChange: (event: ChangeEvent<HTMLInputElement>) => state.type(event.target.value),
    onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => {
      const action = state.keys[event.key];
      if (!action) return;
      event.preventDefault();
      action();
    },
    onFocus: () => state.setOpen(true),
    onBlur: () => state.setOpen(false),
  };
}

/**
 * A text input that suggests names while typing. Arrows move through the suggestions and Enter
 * takes the highlighted one, or the text typed when none is. A name that is not known is marked,
 * never refused: the caller decides what an unknown name means.
 *
 * @param props - Label, suggestions, text, callbacks, the note for an unknown name and the look.
 * @returns The field: label, input and, while typing, the list.
 */
export function SuggestInput(props: SuggestInputProps) {
  const inputId = useId();
  const listId = `${inputId}-list`;
  const state = useSuggestions(props);
  const { mono = false, hideLabel = false, unknownNote } = props;
  const shown = state.open && (state.items.length > 0 || state.unknown);
  return (
    <div className={field.field}>
      <label htmlFor={inputId} className={hideLabel ? field.visuallyHidden : field.label}>
        {props.label}
      </label>
      <div className={styles.box}>
        <input
          id={inputId}
          ref={props.ref}
          className={[field.control, mono && field.mono].filter(Boolean).join(' ')}
          value={props.value}
          placeholder={props.placeholder}
          {...inputAttributes(state, listId, shown)}
        />
        {shown && (
          <SuggestionRows listId={listId} state={state} mono={mono} unknownNote={unknownNote} />
        )}
      </div>
    </div>
  );
}
