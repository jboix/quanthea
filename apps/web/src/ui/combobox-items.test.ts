import { describe, expect, test } from 'bun:test';
import { comboboxItems, labelOf } from './combobox-items.ts';

const options = [
  { value: '', label: 'same as build' },
  { value: 'claude-sonnet-5', label: 'Claude Sonnet 5 · claude-sonnet-5', group: 'Suggested' },
  { value: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 · claude-haiku-4-5', group: 'Suggested' },
  { value: 'gpt-6', label: 'gpt-6', group: 'From the provider' },
];

describe('comboboxItems', () => {
  test('lists every option when nothing is typed', () => {
    expect(comboboxItems(options, '', true)).toHaveLength(4);
  });

  test('keeps the options that have every word typed, in any case', () => {
    expect(comboboxItems(options, 'SONNET claude', false).map((item) => item.value)).toEqual([
      'claude-sonnet-5',
    ]);
  });

  test('offers the typed text when allowed and no option has it', () => {
    expect(comboboxItems(options, ' my-model ', true)).toEqual([
      { value: 'my-model', label: 'Use “my-model”', custom: true },
    ]);
    expect(comboboxItems(options, 'my-model', false)).toEqual([]);
    expect(comboboxItems(options, 'gpt-6', true).map((item) => item.custom)).toEqual([undefined]);
  });

  test('shows a value by its label, or as itself', () => {
    expect(labelOf(options, '')).toBe('same as build');
    expect(labelOf(options, 'unlisted')).toBe('unlisted');
  });
});
