import { expect, test } from 'bun:test';
import { hiddenNote } from './preview-section.tsx';

test('the preview says how many panels the layout of the version hides', () => {
  expect(hiddenNote(3, 0)).toBeUndefined();
  expect(hiddenNote(3, 1)).toBe('1 panel hidden on v3');
  expect(hiddenNote(2, 4)).toBe('4 panels hidden on v2');
});
