import { describe, expect, test } from 'bun:test';
import { snapshotFilters } from '@quanthea/shared';
import { expiryWords, filterChoices, periodWords, takenWords } from './snapshot-words.ts';

const now = Date.UTC(2026, 9, 5, 12);

describe('the Library’s snapshot words', () => {
  test('offers every filter the server takes, in order', () => {
    expect(filterChoices.map((choice) => choice.value)).toEqual([...snapshotFilters]);
  });

  test('names the day of a period once when it fits in one day', () => {
    const time = { from: Date.UTC(2026, 8, 26, 13, 30), to: Date.UTC(2026, 8, 26, 15) };
    expect(periodWords(time, now, 'UTC')).toBe('26 Sep 13:30 – 15:00');
  });

  test('names both days of a period over midnight', () => {
    const time = { from: Date.UTC(2026, 8, 26, 22), to: Date.UTC(2026, 8, 27, 2) };
    expect(periodWords(time, now, 'UTC')).toBe('26 Sep 22:00 – 27 Sep 02:00');
  });

  test('says until when a snapshot lives', () => {
    expect(expiryWords(null)).toBe('kept until revoked');
    expect(expiryWords(Date.UTC(2026, 10, 3, 9), 'UTC')).toBe('until 3 Nov');
  });

  test('says who took a snapshot and when', () => {
    const snapshot = { takenBy: 'Ada', takenAt: Date.UTC(2026, 8, 26, 15, 2) };
    expect(takenWords(snapshot, now, 'UTC')).toBe('Taken by Ada on 26 Sep 15:02');
  });
});
