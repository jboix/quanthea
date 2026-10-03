import { describe, expect, test } from 'bun:test';
import { explainedLine, explanationParagraphs } from './explain-words.ts';

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
