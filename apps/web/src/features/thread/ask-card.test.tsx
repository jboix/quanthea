import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { AskCard } from './ask-card.tsx';
import type { ToolPart } from './messages.ts';

/**
 * An `ask_person` call.
 *
 * @param input - What the agent asked.
 * @returns The tool part.
 */
function ask(input: unknown): ToolPart {
  return { type: 'tool-ask_person', toolCallId: 'call-1', state: 'input-available', input };
}

const options = ['postgres-orders', 'prometheus-dev'];

test('a question with one answer sends an option on a click and has no Send', () => {
  const html = renderToStaticMarkup(
    <AskCard part={ask({ question: 'Which source?', options })} answerable onAnswer={() => {}} />,
  );
  expect(html).toContain('postgres-orders');
  expect(html).not.toContain('aria-pressed');
  expect(html).not.toContain('Send');
});

test('a question with several answers shows toggles and a Send that waits for a pick', () => {
  const part = ask({ question: 'Which sources?', options, multiple: true });
  const html = renderToStaticMarkup(<AskCard part={part} answerable onAnswer={() => {}} />);
  expect(html).toContain('aria-pressed="false"');
  expect(html).toContain('Pick one or more.');
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Send<\/button>/);
});

test('an answered question with several answers has no Send', () => {
  const part = ask({ question: 'Which sources?', options, multiple: true });
  const html = renderToStaticMarkup(<AskCard part={part} answerable={false} onAnswer={() => {}} />);
  expect(html).not.toContain('Send');
});
