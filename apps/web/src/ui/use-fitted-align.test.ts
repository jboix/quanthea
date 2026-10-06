import { describe, expect, test } from 'bun:test';
import { fittedAlign } from './use-fitted-align.ts';

/** The room beside a 56 px rail on a 1440 px wide screen. */
const room = { left: 56, right: 1440 };

describe('fitted align', () => {
  test('keeps the asked edge while the card fits', () => {
    expect(fittedAlign('end', { left: 300, right: 720 }, room)).toBe('end');
    expect(fittedAlign('start', { left: 300, right: 720 }, room)).toBe('start');
  });

  test('lines a card up on its start when its end pushes it under the rail', () => {
    expect(fittedAlign('end', { left: -60, right: 360 }, room)).toBe('start');
  });

  test('lines a card up on its end when its start pushes it off the right edge', () => {
    expect(fittedAlign('start', { left: 1200, right: 1620 }, room)).toBe('end');
  });

  test('keeps the start when the other edge would not fit either', () => {
    expect(fittedAlign('start', { left: 100, right: 1500 }, room)).toBe('start');
  });
});
