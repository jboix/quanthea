import { describe, expect, test } from 'bun:test';
import type { Repair } from '@quanthea/shared';
import type { ThreadPart } from './messages.ts';
import { isWorkPart, workSummary } from './work-summary.ts';

/**
 * A tool call.
 *
 * @param name - The tool.
 * @param state - How far it got.
 * @param output - What it returned.
 * @returns The part.
 */
function call(name: string, state = 'output-available', output: unknown = {}): ThreadPart {
  return { type: `tool-${name}`, toolCallId: `${name}-${state}`, state, output } as ThreadPart;
}

/**
 * A try of the repair loop.
 *
 * @param outcome - What happened.
 * @param attempt - Which failed try it is.
 * @returns The part.
 */
function tried(outcome: Repair['outcome'], attempt = 1): ThreadPart {
  const data: Repair = { attempt, of: 3, outcome, panels: [], issues: [] };
  return { type: 'data-repair', data } as ThreadPart;
}

describe('the work line', () => {
  test('folds explore calls, writes and tries the agent still fixes, not a stopped try', () => {
    expect(isWorkPart(call('describe'))).toBe(true);
    expect(isWorkPart(call('edit_dashboard'))).toBe(true);
    expect(isWorkPart(tried('failed'))).toBe(true);
    expect(isWorkPart(tried('exhausted', 3))).toBe(false);
    expect(isWorkPart(call('ask_person'))).toBe(false);
    expect(isWorkPart({ type: 'text', text: 'Hi' } as ThreadPart)).toBe(false);
  });

  test('says what the agent is doing while it works', () => {
    expect(workSummary([call('describe', 'input-available')], true)).toEqual({
      text: 'Looking at the data…',
      state: 'working',
    });
    expect(
      workSummary([call('describe'), call('edit_dashboard', 'input-available')], true).text,
    ).toBe('Building…');
  });

  test('says it is fixing a problem while a failed try is not fixed yet', () => {
    const parts = [call('edit_dashboard', 'output-available', { ok: false }), tried('failed')];
    expect(workSummary(parts, true)).toEqual({
      text: 'Fixing a problem with a query…',
      state: 'fixing',
    });
  });

  test('says what it did once done, and that it fixed a failure', () => {
    const parts = [
      call('describe'),
      call('sample_values'),
      call('edit_dashboard', 'output-available', { ok: false }),
      tried('failed'),
      call('edit_dashboard', 'output-available', { ok: true, version: 2 }),
      tried('repaired', 1),
    ];
    expect(workSummary(parts, false)).toEqual({
      text: 'Explored 2 steps · built v2 · fixed after 1 failed try',
      state: 'fixed',
    });
  });

  test('says what it explored when it built nothing', () => {
    expect(workSummary([call('describe')], false)).toEqual({
      text: 'Explored 1 step',
      state: 'done',
    });
  });

  test('says how many times it tried when nothing was saved', () => {
    const failed = call('edit_dashboard', 'output-available', { ok: false });
    expect(workSummary([failed, tried('failed'), failed], false).text).toBe('Tried 2 times');
  });
});
