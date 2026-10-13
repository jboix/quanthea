import { describe, expect, test } from 'bun:test';
import { earlierVersionNote, explainedLine, explanationParagraphs } from './explain-words.ts';

describe('explanationParagraphs', () => {
  test('cuts the text at blank lines and trims each paragraph', () => {
    const text = 'It counts errors.\n\n  It reads the events table.  \n \nIt uses a count.';
    expect(explanationParagraphs(text)).toEqual([
      'It counts errors.',
      'It reads the events table.',
      'It uses a count.',
    ]);
  });

  test('keeps a single line break inside a paragraph', () => {
    expect(explanationParagraphs('One line\nand the next.')).toEqual(['One line\nand the next.']);
  });

  test('drops citation markers, which point nowhere in an explanation', () => {
    expect(explanationParagraphs('It counts errors [1], as Latency [2] does.')).toEqual([
      'It counts errors, as Latency does.',
    ]);
  });

  test('gives no paragraph for an empty text', () => {
    expect(explanationParagraphs(' \n\n ')).toEqual([]);
  });
});

describe('explainedLine', () => {
  test('names the day with its year in the time zone, and who asked', () => {
    const at = Date.parse('2026-10-03T23:30:00Z');
    expect(explainedLine({ explainedAt: at, explainedBy: 'Ana' }, 'UTC')).toBe(
      'Explained on 3 Oct 2026 for Ana',
    );
    expect(explainedLine({ explainedAt: at, explainedBy: 'Ana' }, 'Europe/Zurich')).toBe(
      'Explained on 4 Oct 2026 for Ana',
    );
  });
});

/**
 * What a panel shows: an explanation written for a version, or none.
 *
 * @param version - The version it was written for, `null` for no explanation.
 * @param panelChanged - Whether the panel changed since.
 * @returns What the panel shows.
 */
function shown(version: number | null, panelChanged = false) {
  return { explanation: version === null ? null : { version }, panelChanged };
}

describe('earlierVersionNote', () => {
  test('says nothing for an explanation of the version shown, for none, or while loading', () => {
    expect(earlierVersionNote(shown(3), 3)).toBeNull();
    expect(earlierVersionNote(shown(null), 3)).toBeNull();
    expect(earlierVersionNote(undefined, 3)).toBeNull();
  });

  test('names the version an earlier one was written for', () => {
    expect(earlierVersionNote(shown(2), 5)).toBe(
      "Written for v2. The panel's query and view are the same in v5.",
    );
  });

  test('says the panel changed since when its query or view did', () => {
    expect(earlierVersionNote(shown(2, true), 5)).toBe('Written for v2. The panel changed since.');
  });
});
