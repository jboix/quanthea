import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ToolPart } from './messages.ts';
import { BuildLog } from './tool-logs.tsx';

/**
 * A dashboard write at some state.
 *
 * @param state - How far the call got.
 * @param output - What it returned, if anything.
 * @returns The tool part.
 */
function write(state: string, output?: unknown): ToolPart {
  return { type: 'tool-edit_dashboard', toolCallId: 'call-1', state, output };
}

test('a running write shows its moving heading and no empty list', () => {
  const html = renderToStaticMarkup(<BuildLog part={write('input-available')} />);
  expect(html).toContain('Building…');
  expect(html).toContain('data-running="true"');
  expect(html).not.toContain('<ul');
});

test('a finished write lists its panels and stops moving', () => {
  const output = {
    ok: true,
    version: 2,
    panels: [{ panelId: 'errors', queries: [{ refId: 'A', ok: true, frames: [{ rowCount: 3 }] }] }],
  };
  const html = renderToStaticMarkup(<BuildLog part={write('output-available', output)} />);
  expect(html).toContain('Built v2');
  expect(html).toContain('<ul');
  expect(html).toContain('data-running="false"');
});

test('a write that threw shows why', () => {
  const part = { ...write('output-error'), errorText: 'The connector is gone.' };
  expect(renderToStaticMarkup(<BuildLog part={part} />)).toContain('The connector is gone.');
});
