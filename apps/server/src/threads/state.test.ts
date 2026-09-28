import { describe, expect, test } from 'bun:test';
import { canWrite, nextState, type ThreadEvent, type ThreadState } from './state.ts';

const states: ThreadState[] = ['idle', 'plan_pending', 'building', 'ready'];
const events: ThreadEvent[] = ['propose', 'approve', 'reject', 'built', 'message'];

describe('thread state machine', () => {
  test('allows exactly the documented transitions', () => {
    const table = Object.fromEntries(
      events.map((event) => [
        event,
        Object.fromEntries(states.map((state) => [state, nextState(state, event) ?? '-'])),
      ]),
    );
    expect(table).toEqual({
      propose: {
        idle: 'plan_pending',
        plan_pending: 'plan_pending',
        building: 'plan_pending',
        ready: 'plan_pending',
      },
      approve: { idle: '-', plan_pending: 'building', building: '-', ready: '-' },
      reject: { idle: '-', plan_pending: 'idle', building: '-', ready: '-' },
      built: { idle: '-', plan_pending: '-', building: 'ready', ready: 'ready' },
      message: { idle: 'idle', plan_pending: 'idle', building: 'building', ready: 'ready' },
    });
  });

  test('writes only after approval, or as a small edit of a ready thread', () => {
    expect(states.map((state) => [state, canWrite(state, false), canWrite(state, true)])).toEqual([
      ['idle', false, false],
      ['plan_pending', false, false],
      ['building', true, true],
      ['ready', false, true],
    ]);
  });
});
