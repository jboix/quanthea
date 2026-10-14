import { expect, test } from 'bun:test';
import { withMention } from './mention-panel.ts';

test('a mention goes at the start of the text', () => {
  expect(withMention('', 'Error rate')).toBe('@Error rate ');
  expect(withMention('  split by region', 'Error rate')).toBe('@Error rate split by region');
});

test('a panel already mentioned is not mentioned twice', () => {
  expect(withMention('make @Error rate red', 'Error rate')).toBe('make @Error rate red');
});
