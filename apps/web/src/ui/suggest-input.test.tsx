import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  closedSuggestions,
  SuggestField,
  SuggestInput,
  suggestionState,
} from './suggest-input.tsx';

/** The names on offer. */
const names = ['customers.email', 'customers.id', 'orders.total'];

/**
 * A suggesting input held by hand, as its component holds it: the text, what it keeps between
 * renders, and what it called. The test runner has no document, so an event is handed to the
 * state's handler and the field is drawn again from what is held.
 *
 * @param onCancel - What Escape calls once the list is closed, if the caller gives up that way.
 * @returns The state for the next event, the field as drawn, the text, and the calls made.
 */
function heldInput(onCancel?: () => void) {
  let value = '';
  let held = closedSuggestions;
  const taken: string[] = [];
  const props = () => ({
    label: 'Column',
    suggestions: names,
    unknownNote: 'Not in the schema.',
    value,
    onChange: (text: string) => {
      value = text;
    },
    onCommit: (name: string) => {
      taken.push(name);
      value = '';
    },
    ...(onCancel && { onCancel }),
  });
  const hold = (next: typeof closedSuggestions) => {
    held = next;
  };
  const state = () => suggestionState(props(), held, hold);
  const html = () =>
    renderToStaticMarkup(<SuggestField {...props()} inputId="field" state={state()} />);
  return { state, html, taken, text: () => value };
}

/**
 * The options a drawn field lists.
 *
 * @param html - The field as drawn.
 * @returns The names, in order.
 */
function optionsOf(html: string): string[] {
  return [...html.matchAll(/role="option"[^>]*>([^<]*)</g)].map((match) => match[1] ?? '');
}

test('the list is closed until the field has the focus', () => {
  const input = heldInput();
  expect(input.html()).toContain('aria-expanded="false"');
  expect(optionsOf(input.html())).toEqual([]);
  input.state().focus();
  expect(input.html()).toContain('aria-expanded="true"');
  expect(optionsOf(input.html())).toEqual(names);
});

test('the component starts closed, tied to its list', () => {
  const html = renderToStaticMarkup(
    <SuggestInput
      label="Column"
      suggestions={names}
      value=""
      onChange={() => {}}
      onCommit={() => {}}
    />,
  );
  expect(html).toContain('role="combobox"');
  expect(html).toContain('aria-expanded="false"');
  expect(optionsOf(html)).toEqual([]);
});

test('typing filters the list and marks a name that is not known', () => {
  const input = heldInput();
  input.state().type('email');
  expect(optionsOf(input.html())).toEqual(['customers.email']);
  input.state().type('nothing');
  expect(optionsOf(input.html())).toEqual([]);
  expect(input.html()).toContain('Not in the schema.');
  expect(input.html()).toContain('aria-describedby="field-list-unknown"');
});

test('the arrows move the highlight, and up from the first gives the text back', () => {
  const input = heldInput();
  input.state().focus();
  expect(input.state().press('ArrowDown')).toBe(true);
  expect(input.html()).toContain('aria-activedescendant="field-list-0"');
  input.state().press('ArrowDown');
  expect(input.html()).toContain('aria-activedescendant="field-list-1"');
  expect(input.html()).toContain(
    'id="field-list-1" role="option" tabindex="-1" aria-selected="true"',
  );
  input.state().press('ArrowUp');
  input.state().press('ArrowUp');
  expect(input.html()).not.toContain('aria-activedescendant');
  expect(input.html()).toContain('aria-expanded="true"');
});

test('the down arrow stops at the last suggestion', () => {
  const input = heldInput();
  input.state().focus();
  for (const _ of [1, 2, 3, 4, 5]) input.state().press('ArrowDown');
  expect(input.state().current).toBe(names.length - 1);
});

test('Enter takes the highlighted suggestion and closes the list', () => {
  const input = heldInput();
  input.state().type('cust');
  input.state().press('ArrowDown');
  input.state().press('ArrowDown');
  expect(input.state().press('Enter')).toBe(true);
  expect(input.taken).toEqual(['customers.id']);
  expect(input.html()).toContain('aria-expanded="false"');
});

test('Enter with nothing highlighted takes the text typed, without its spaces', () => {
  const input = heldInput();
  input.state().type('  audit.* ');
  input.state().press('Enter');
  expect(input.taken).toEqual(['audit.*']);
});

test('Enter takes nothing from an empty field', () => {
  const input = heldInput();
  input.state().focus();
  input.state().press('Enter');
  expect(input.taken).toEqual([]);
});

test('the list stays closed after a name is taken, until the next key', () => {
  const input = heldInput();
  input.state().type('orders');
  input.state().press('Enter');
  expect(input.text()).toBe('');
  expect(optionsOf(input.html())).toEqual([]);
  input.state().press('ArrowDown');
  expect(optionsOf(input.html())).toEqual(names);
  expect(input.html()).toContain('aria-activedescendant="field-list-0"');
});

test('Escape closes an open list, and gives up only once it is closed', () => {
  let cancelled = 0;
  const input = heldInput(() => {
    cancelled += 1;
  });
  input.state().focus();
  input.state().press('ArrowDown');
  expect(input.state().press('Escape')).toBe(true);
  expect(cancelled).toBe(0);
  expect(input.html()).toContain('aria-expanded="false"');
  expect(input.state().current).toBe(-1);
  expect(input.state().press('Escape')).toBe(true);
  expect(cancelled).toBe(1);
});

test('Escape is left to the browser when the list is closed and nothing gives up', () => {
  const input = heldInput();
  input.state().focus();
  expect(input.state().press('Escape')).toBe(true);
  expect(input.state().press('Escape')).toBe(false);
});

test('a key the field does not use is left to the browser', () => {
  const input = heldInput();
  input.state().focus();
  expect(input.state().press('a')).toBe(false);
  expect(input.state().press('constructor')).toBe(false);
});

test('a mouse pick takes the suggestion pointed at and closes the list', () => {
  const input = heldInput();
  input.state().focus();
  input.state().highlight(2);
  expect(input.html()).toContain('aria-activedescendant="field-list-2"');
  input.state().commit(input.state().items[2]);
  expect(input.taken).toEqual(['orders.total']);
  expect(input.html()).toContain('aria-expanded="false"');
});

test('leaving the field closes the list', () => {
  const input = heldInput();
  input.state().focus();
  input.state().blur();
  expect(optionsOf(input.html())).toEqual([]);
});
