import { describe, expect, test } from 'bun:test';
import type { Repair } from '@quanthea/shared';
import type { ThreadMessage } from './messages.ts';
import { buildStopped, lastRepair, repairTitle } from './repairs.ts';

/**
 * A try of the repair loop.
 *
 * @param outcome - What happened.
 * @param attempt - Which failed try it is.
 * @returns The repair.
 */
function repair(outcome: Repair['outcome'], attempt = 1): Repair {
  const panels = [{ id: 'errors', title: 'Errors', problems: ['no such table: missing'] }];
  return { attempt, of: 3, outcome, panels: outcome === 'repaired' ? [] : panels, issues: [] };
}

/**
 * An answer with repair parts.
 *
 * @param repairs - Its repairs, in order.
 * @returns The message.
 */
function answer(...repairs: Repair[]): ThreadMessage {
  const parts = repairs.map((data) => ({ type: 'data-repair' as const, data }));
  return { id: 'a1', role: 'assistant', parts } as ThreadMessage;
}

describe('the repair loop in the thread', () => {
  test('heads each try with what happened and how many are left', () => {
    expect(repairTitle(repair('failed'))).toBe('Not saved · the agent fixes it, try 1 of 3');
    expect(repairTitle(repair('left-out', 2))).toBe(
      'Saved without 1 panel · the agent fixes it, try 2 of 3',
    );
    expect(repairTitle(repair('repaired', 2))).toBe('Fixed after 2 failed tries');
    expect(repairTitle(repair('exhausted', 3))).toBe('Stopped after 3 failed tries');
  });

  test('knows when the latest answer stopped with failures left, and only then', () => {
    expect(buildStopped([answer(repair('failed'), repair('exhausted', 3))])).toBe(true);
    expect(buildStopped([answer(repair('failed'), repair('repaired'))])).toBe(false);
    const asked = { id: 'u2', role: 'user', parts: [] } as unknown as ThreadMessage;
    expect(buildStopped([answer(repair('exhausted', 3)), asked])).toBe(false);
    expect(lastRepair([answer()])).toBeUndefined();
  });
});
