import { expect, test } from 'bun:test';
import { kindFrom, kindWords, maxPromptLength, promptFrom } from './thread-kinds.ts';

test('a link picks the alert kind with ?make=alert, and a dashboard otherwise', () => {
  expect(kindFrom('alert')).toBe('alert');
  expect(kindFrom(null)).toBe('dashboard');
  expect(kindFrom('nonsense')).toBe('dashboard');
});

test('a link picks the report kind with ?make=report, which has its own words', () => {
  expect(kindFrom('report')).toBe('report');
  expect(kindWords.report.label).toBe('A report');
});

test('a placeholder names nothing the connected data may not have', () => {
  expect(kindWords.dashboard.placeholder).toBe('What do you want to see?');
  expect(kindWords.alert.placeholder).toBe('Tell me when…');
  expect(kindWords.report.placeholder).toBe('Every Monday at 8:00, last week’s…');
});

test('a link fills the box with ?prompt=, trimmed, without control characters, capped', () => {
  expect(promptFrom(new URLSearchParams('prompt=%20Watch%20checkout%0A'))).toBe('Watch checkout');
  expect(promptFrom(new URLSearchParams('prompt=a%00b%1Bc%0Ad'))).toBe('abc\nd');
  expect(promptFrom(new URLSearchParams('question=Orders'))).toBe('Orders');
  expect(promptFrom(new URLSearchParams('prompt=First&question=Second'))).toBe('First');
  expect(promptFrom(new URLSearchParams())).toBe('');
  const long = new URLSearchParams({ prompt: 'x'.repeat(maxPromptLength + 50) });
  expect(promptFrom(long)).toHaveLength(maxPromptLength);
});
