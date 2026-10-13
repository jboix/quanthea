import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { Pager } from './pager.tsx';

/** Does nothing. */
const move = () => undefined;

test('says how many entries there are, with no controls for a list of one page', () => {
  const html = renderToStaticMarkup(<Pager label="Pages" offset={0} shown={4} total={4} />);
  expect(html).toContain('1–4 of 4');
  expect(html).not.toContain('<button');
  expect(renderToStaticMarkup(<Pager label="Pages" offset={0} shown={0} total={0} />)).toBe('');
});

test('Newer waits on the first page and Older on the last', () => {
  const first = renderToStaticMarkup(
    <Pager label="Pages" offset={0} shown={10} total={24} onOlder={move} />,
  );
  expect(first).toContain('1–10 of 24');
  expect(first).toMatch(/<button[^>]*disabled=""[^>]*>Newer/);
  expect(first).not.toMatch(/<button[^>]*disabled=""[^>]*>Older/);
  const last = renderToStaticMarkup(
    <Pager label="Pages" offset={20} shown={4} total={24} onNewer={move} />,
  );
  expect(last).toContain('21–24 of 24');
  expect(last).toMatch(/<button[^>]*disabled=""[^>]*>Older/);
  expect(last).not.toMatch(/<button[^>]*disabled=""[^>]*>Newer/);
});

test('both controls wait while a page loads', () => {
  const html = renderToStaticMarkup(
    <Pager label="Pages" offset={10} shown={10} total={24} onNewer={move} onOlder={move} busy />,
  );
  expect(html.match(/disabled=""/g)).toHaveLength(2);
});

test('names its controls otherwise for a list that is not in order of time', () => {
  const words = { newer: 'Previous', older: 'Next' };
  const html = renderToStaticMarkup(
    <Pager label="Pages" offset={0} shown={10} total={24} onOlder={move} words={words} />,
  );
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Previous/);
  expect(html).toContain('Next');
  expect(html).not.toContain('Newer');
});
