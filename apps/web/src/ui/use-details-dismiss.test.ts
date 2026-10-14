import { expect, test } from 'bun:test';
import { dismissalOf } from './use-details-dismiss.ts';

test('a press outside an open menu closes it', () => {
  expect(dismissalOf({ type: 'pointerdown' }, false)).toBe('close');
});

test('a press inside an open menu leaves it open', () => {
  expect(dismissalOf({ type: 'pointerdown' }, true)).toBe('stay');
});

test('Escape closes the menu and gives focus back, from inside or outside', () => {
  expect(dismissalOf({ type: 'keydown', key: 'Escape' }, true)).toBe('refocus');
  expect(dismissalOf({ type: 'keydown', key: 'Escape' }, false)).toBe('refocus');
});

test('another key leaves the menu open', () => {
  expect(dismissalOf({ type: 'keydown', key: 'ArrowDown' }, true)).toBe('stay');
});
