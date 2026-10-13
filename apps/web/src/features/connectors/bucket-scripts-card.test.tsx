import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { BucketScriptsForm } from './bucket-scripts-card.tsx';

/**
 * Renders the card.
 *
 * @param stored - Whether the connector allows bucket scripts.
 * @param draft - Whether the switch is on.
 * @param more - Whether a change is on its way, and why the last one failed.
 * @returns The markup.
 */
function card(stored: boolean, draft: boolean, more: { pending?: boolean; failure?: string } = {}) {
  return renderToStaticMarkup(
    <BucketScriptsForm
      stored={stored}
      draft={draft}
      onChange={() => undefined}
      onSave={() => undefined}
      pending={more.pending ?? false}
      failure={more.failure}
    />,
  );
}

test('is off as stored, says what runs, and has nothing to save', () => {
  const html = card(false, false);
  expect(html).toMatch(/role="switch" aria-checked="false"/);
  expect(html).toContain('the two fixed ratio scripts and no other');
  expect(html).toContain('Every script that reads documents stays refused either way');
  expect(html).toMatch(/<button type="submit"[^>]*disabled=""[^>]*>Save<\/button>/);
});

test('once flipped, says what a query may hold and offers to save', () => {
  const html = card(false, true);
  expect(html).toMatch(/role="switch" aria-checked="true"/);
  expect(html).toContain('one arithmetic expression of its own');
  expect(html).not.toMatch(/<button type="submit"[^>]*disabled/);
});

test('waits while a change is on its way, and says why one failed', () => {
  expect(card(false, true, { pending: true })).toMatch(/disabled=""[^>]*>Saving…<\/button>/);
  expect(card(true, true, { failure: 'The file manages this.' })).toContain(
    'The file manages this.',
  );
});
