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
  /** Called on Escape while the list is closed. The first Escape closes a list that shows. */
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

/** What a suggesting input holds between renders: whether its list is open, and the highlight. */
interface HeldSuggestions {
  /** Whether the list is open. It shows only while it also has something to show. */
  readonly open: boolean;
  /** The highlighted place, or `-1` for the typed text itself. */
  readonly active: number;
}

/** A suggesting input at rest: its list closed and nothing highlighted. */
export const closedSuggestions: HeldSuggestions = { open: false, active: -1 };

/**
 * What the text typed matches: the suggestions listed, how many more match, the text without its
 * surrounding spaces, and whether it is a name the input does not know.
 *
 * @param props - The suggestions, the text and the test of a known name.
 * @returns The suggestions, the count left out, the text and the mark.
 */
function matched(props: SuggestInputProps) {
  const { suggestions, value } = props;
  const typed = value.trim();
  const known = props.isKnown ?? ((name: string) => isSuggested(suggestions, name));
  const unknown = props.unknownNote !== undefined && typed !== '' && !known(typed);
  return { ...suggestionsFor(suggestions, value), typed, unknown };
}

/**
 * The state of a suggesting input, and what typing, the keys and the mouse do to it. Escape closes
 * a list that shows, and gives up only once it is closed. Taking a name closes the list.
 *
 * @param props - The suggestions, the text, the callbacks and the test of a known name.
 * @param held - What the input holds between renders.
 * @param hold - Replaces what it holds.
 * @returns The list to show, the highlight, and the handlers.
 */
export function suggestionState(
  props: SuggestInputProps,
  held: HeldSuggestions,
  hold: (next: HeldSuggestions) => void,
) {
  const { items, more, typed, unknown } = matched(props);
  const shown = held.open && (items.length > 0 || unknown);
  const current = shown ? Math.min(held.active, items.length - 1) : -1;
  const commit = (name: string | undefined) => {
    if (name === undefined || name === '') return;
    hold(closedSuggestions);
    props.onCommit(name);
  };
  const keys: Readonly<Record<string, (() => void) | undefined>> = {
    ArrowDown: () => hold({ open: true, active: movedHighlight(current, 1, items.length) }),
    ArrowUp: () => hold({ ...held, active: movedHighlight(current, -1, items.length) }),
    Enter: () => commit(items[current] ?? typed),
    Escape: shown ? () => hold(closedSuggestions) : props.onCancel,
  };
  return { shown, items, more, unknown, current, commit, ...handlers(props, keys, hold) };
}

/**
 * What the field's events do: typing and the focus open the list, leaving closes it, the pointer
 * highlights, and a key does its action.
 *
 * @param props - The callback for the text typed.
 * @param keys - What each key does. A key with nothing to do is left to the browser.
 * @param hold - Replaces what the input holds.
 * @returns The handlers. `press` says whether the key was used.
 */
function handlers(
  props: SuggestInputProps,
  keys: Readonly<Record<string, (() => void) | undefined>>,
  hold: (next: HeldSuggestions) => void,
) {
  return {
    type: (text: string) => {
      props.onChange(text);
      hold({ open: true, active: -1 });
    },
    focus: () => hold({ open: true, active: -1 }),
    blur: () => hold(closedSuggestions),
    highlight: (active: number) => hold({ open: true, active }),
    press: (key: string): boolean => {
      const action = Object.hasOwn(keys, key) ? keys[key] : undefined;
      action?.();
      return action !== undefined;
    },
  };
}

/** The state {@link suggestionState} returns. */
type SuggestionState = ReturnType<typeof suggestionState>;

/** Props of {@link SuggestionRows}. */
interface SuggestionRowsProps {
  /** The list's id. */
  readonly listId: string;
  /** What {@link suggestionState} returns. */
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
            onMouseEnter={() => state.highlight(index)}
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
 * and take, and leaving closes the list. A key the field does not use keeps its default.
 *
 * @param state - What {@link suggestionState} returns.
 * @param listId - The list's id.
 * @returns The attributes of the input element.
 */
function inputAttributes(state: SuggestionState, listId: string) {
  return {
    role: 'combobox',
    'aria-expanded': state.shown,
    'aria-controls': listId,
    'aria-autocomplete': 'list' as const,
    'aria-activedescendant': state.current >= 0 ? `${listId}-${state.current}` : undefined,
    'aria-describedby': state.shown && state.unknown ? `${listId}-unknown` : undefined,
    autoComplete: 'off',
    spellCheck: false,
    onChange: (event: ChangeEvent<HTMLInputElement>) => state.type(event.target.value),
    onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => {
      if (state.press(event.key)) event.preventDefault();
    },
    onFocus: state.focus,
    onBlur: state.blur,
  };
}

/** Props of {@link SuggestField}. */
interface SuggestFieldProps extends SuggestInputProps {
  /** The id of the input element. The list's id follows from it. */
  readonly inputId: string;
  /** What {@link suggestionState} returns. */
  readonly state: SuggestionState;
}

/**
 * The field as drawn for a state: the label, the input and, while it shows, the list.
 *
 * @param props - The input's props, its id and its state.
 * @returns The field.
 */
export function SuggestField(props: SuggestFieldProps) {
  const { inputId, state, mono = false, hideLabel = false, unknownNote } = props;
  const listId = `${inputId}-list`;
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
          {...inputAttributes(state, listId)}
        />
        {state.shown && (
          <SuggestionRows listId={listId} state={state} mono={mono} unknownNote={unknownNote} />
        )}
      </div>
    </div>
  );
}

/**
 * A text input that suggests names while typing. Arrows move through the suggestions and Enter
 * takes the highlighted one, or the text typed when none is, and closes the list. Escape closes
 * the list, and gives up once it is closed. A name that is not known is marked, never refused:
 * the caller decides what an unknown name means.
 *
 * @param props - Label, suggestions, text, callbacks, the note for an unknown name and the look.
 * @returns The field: label, input and, while typing, the list.
 */
export function SuggestInput(props: SuggestInputProps) {
  const inputId = useId();
  const [held, hold] = useState(closedSuggestions);
  return <SuggestField {...props} inputId={inputId} state={suggestionState(props, held, hold)} />;
}
