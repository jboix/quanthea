import { expect, test } from 'bun:test';
import { versionNote } from './version-note.ts';

test('names the version shown, one pinned before, and drafts by their summary', () => {
  const version = {
    version: 2,
    changeSummary: 'Added latency',
    pinnedAt: null,
    actor: null,
    createdAt: 0,
  };
  expect(versionNote({ ...version, pinnedAt: 5 }, 2)).toBe('pinned');
  expect(versionNote({ ...version, pinnedAt: 5 }, 3)).toBe('pinned before');
  expect(versionNote(version, null)).toBe('Added latency');
  expect(versionNote({ ...version, changeSummary: null }, null)).toBe('draft');
});
