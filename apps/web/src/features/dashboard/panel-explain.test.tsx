import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { earlierVersionNote } from './explain-words.ts';
import { StoredExplanation } from './panel-explain.tsx';

const text = 'Counts the orders of each hour.';

/**
 * Renders a stored explanation written for a version, on the page of version 5.
 *
 * @param version - The version it was written for.
 * @param panelChanged - Whether the panel changed since.
 * @returns The markup.
 */
function render(version: number, panelChanged = false): string {
  const earlier = earlierVersionNote({ explanation: { version }, panelChanged }, 5);
  return renderToStaticMarkup(<StoredExplanation text={text} earlier={earlier} />);
}

test('an explanation of the version shown has no note', () => {
  const html = render(5);
  expect(html).toContain(text);
  expect(html.match(/<p/g)).toHaveLength(1);
});

test('one of an earlier version says so after the text when the panel is unchanged', () => {
  const html = render(2);
  expect(html).toContain('Written for v2.');
  expect(html.indexOf(text)).toBeLessThan(html.indexOf('Written for v2.'));
});

test('one of an earlier version says so before the text when the panel changed', () => {
  const html = render(2, true);
  const note = html.indexOf('This explains the panel as it was in v2.');
  expect(note).toBeGreaterThanOrEqual(0);
  expect(note).toBeLessThan(html.indexOf(text));
});
