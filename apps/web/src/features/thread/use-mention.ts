/**
 * The composer's `@` menu: which panels it lists, the one chosen, moving with the arrow keys,
 * picking with Enter or Tab, and closing it for the `@` being typed.
 */
import { type KeyboardEvent, type RefObject, useState } from 'react';
import { type MentionablePanel, mentionAt, mentionGhost, mentionMatches } from './mention-query.ts';

/** The menu's state and what it does. */
export interface MentionMenuState {
  /** The panels listed; empty when the menu is shut. */
  readonly matches: readonly MentionablePanel[];
  /** The index of the panel Enter picks. */
  readonly active: number;
  /** The rest of the chosen panel's title, shown greyed after the text. */
  readonly ghost: string;
  /** Puts a panel's mention in place of the `@` being typed. */
  readonly pick: (panel: MentionablePanel) => void;
  /** Chooses the panel at an index. */
  readonly choose: (index: number) => void;
  /** Shuts the menu until another `@` is typed. */
  readonly dismiss: () => void;
  /** Handles the menu's keys; returns whether it took the key. */
  readonly onKey: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean;
}

/**
 * The index the arrow keys move to.
 *
 * @param key - The key pressed.
 * @param active - The index chosen.
 * @param count - How many panels are listed.
 * @returns The new index, or `undefined` for another key.
 */
function moved(key: string, active: number, count: number): number | undefined {
  if (key === 'ArrowDown') return (active + 1) % count;
  if (key === 'ArrowUp') return (active - 1 + count) % count;
  return undefined;
}

/**
 * The menu's keys: the arrows move, Enter or Tab pick, Escape shuts it.
 *
 * @param event - The key event.
 * @param menu - The menu.
 * @returns Whether the menu took the key.
 */
function menuKey(event: KeyboardEvent<HTMLTextAreaElement>, menu: MentionMenuState): boolean {
  const next = moved(event.key, menu.active, menu.matches.length);
  if (next !== undefined) menu.choose(next);
  else if (event.key === 'Escape') menu.dismiss();
  else if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
    const panel = menu.matches[menu.active];
    if (panel) menu.pick(panel);
  } else return false;
  event.preventDefault();
  return true;
}

/**
 * The `@` menu of the composer.
 *
 * @param draft - The text being written.
 * @param onDraft - Changes the text.
 * @param panels - The panels that can be mentioned.
 * @param input - The text box, focused again after a pick.
 * @returns The menu's state, and the change handler that opens it again for a new `@`.
 */
export function useMentionMenu(
  draft: string,
  onDraft: (draft: string) => void,
  panels: readonly MentionablePanel[],
  input: RefObject<HTMLTextAreaElement | null>,
): { readonly menu: MentionMenuState; readonly onChange: (text: string) => void } {
  const [dismissedAt, setDismissedAt] = useState<number>();
  const [cursor, setCursor] = useState({ key: '', index: 0 });
  const typed = mentionAt(draft, panels);
  const open = typed !== undefined && typed.start !== dismissedAt;
  const matches = open ? mentionMatches(typed.query, panels) : [];
  const key = typed ? `${typed.start}:${typed.query}` : '';
  const active = cursor.key === key && cursor.index < matches.length ? cursor.index : 0;
  const menu: MentionMenuState = {
    matches,
    active,
    ghost: matches[active] && typed ? mentionGhost(matches[active].title, typed.query) : '',
    pick: (panel) => {
      onDraft(`${draft.slice(0, typed?.start ?? draft.length)}@${panel.title} `);
      input.current?.focus();
    },
    choose: (index) => setCursor({ key, index }),
    dismiss: () => setDismissedAt(typed?.start),
    onKey: (event) => matches.length > 0 && menuKey(event, menu),
  };
  const onChange = (text: string) => {
    if (mentionAt(text, panels)?.start !== dismissedAt) setDismissedAt(undefined);
    onDraft(text);
  };
  return { menu, onChange };
}
