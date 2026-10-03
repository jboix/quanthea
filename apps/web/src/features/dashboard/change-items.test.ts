import { describe, expect, test } from 'bun:test';
import { changeItems, changeWords } from './change-items.ts';

/** A dashboard with no thread. */
const noThread = { threadId: null, threadBinned: false, threadOfOther: false };

describe('changeItems', () => {
  test('opens the thread that built the dashboard, then offers a copy', () => {
    const items = changeItems({ ...noThread, threadId: 't1' }, true);
    expect(items).toEqual([{ kind: 'open-thread', threadId: 't1' }, { kind: 'copy' }]);
    expect(items.map((item) => changeWords(item).label)).toEqual([
      'Edit with the agent',
      'New dashboard from this',
    ]);
  });

  test('starts a conversation on a dashboard without a thread', () => {
    expect(changeItems(noThread, true)).toEqual([{ kind: 'new-thread' }, { kind: 'copy' }]);
  });

  test('says when its conversation is in the bin', () => {
    const [edit] = changeItems({ ...noThread, threadBinned: true }, true);
    expect(edit).toEqual({ kind: 'thread-in-bin' });
    expect(edit && changeWords(edit).hint).toBe('its conversation is in the bin');
  });

  test("offers only a copy when the thread is someone else's", () => {
    expect(changeItems({ ...noThread, threadOfOther: true }, true)).toEqual([{ kind: 'copy' }]);
  });

  test('offers nothing to viewers and analysts', () => {
    expect(changeItems({ ...noThread, threadId: 't1' }, false)).toEqual([]);
  });

  test('each item says what it does', () => {
    expect(changeWords({ kind: 'open-thread', threadId: 't1' }).hint).toBe(
      'opens the conversation that built this dashboard',
    );
    expect(changeWords({ kind: 'new-thread' }).hint).toBe(
      'starts a conversation about this dashboard',
    );
    expect(changeWords({ kind: 'copy' }).hint).toBe('starts a new conversation from a copy');
  });
});
