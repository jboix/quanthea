import { describe, expect, test } from 'bun:test';
import { snapshotLifetimes } from '@quanthea/shared';
import { lifetimeChoices, rangeWords, snapshotsLabel, untilWords } from './snapshot-words.ts';

describe('snapshot words', () => {
  test('offers every lifetime the server takes, in order', () => {
    expect(lifetimeChoices.map((choice) => choice.value)).toEqual([...snapshotLifetimes]);
  });

  test('says how long a snapshot lives', () => {
    expect(untilWords(null)).toBe('until revoked');
    expect(untilWords(Date.UTC(2026, 9, 9, 12))).toStartWith('until ');
  });

  test('reads a frozen range as absolute times in the dashboard’s zone', () => {
    const time = { from: Date.UTC(2026, 8, 30, 13), to: Date.UTC(2026, 8, 30, 15) };
    expect(rangeWords(time, 'UTC')).toMatch(/13:00.*15:00/);
  });

  test('counts the live snapshots once they are known', () => {
    expect(snapshotsLabel(undefined)).toBe('Snapshots of this dashboard');
    expect(snapshotsLabel(3)).toBe('Snapshots of this dashboard (3)');
  });
});
