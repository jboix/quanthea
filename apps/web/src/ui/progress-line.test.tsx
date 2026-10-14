import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProgressLine } from './progress-line.tsx';

test('a named line with a value is a progress bar at that value', () => {
  const html = renderToStaticMarkup(<ProgressLine value={0.25} label="Loading panels" />);
  expect(html).toContain('role="progressbar"');
  expect(html).toContain('aria-valuenow="25"');
  expect(html).toContain('width:25%');
});

test('a line without a name is hidden from screen readers and moves', () => {
  const html = renderToStaticMarkup(<ProgressLine />);
  expect(html).toContain('aria-hidden="true"');
  expect(html).toContain('data-known="false"');
});

test('a value past the ends is held to them', () => {
  expect(renderToStaticMarkup(<ProgressLine value={1.4} />)).toContain('width:100%');
});
