import { describe, expect, test } from 'bun:test';
import { smoothAreaPath, smoothPath } from './chart-geometry.ts';

const area = { left: 0, right: 100, top: 0, bottom: 10 };

describe('smooth paths', () => {
  test('start at the first value and end at the last, through a curve per segment', () => {
    const path = smoothPath([0, 1, 0], area, [0, 1]);
    expect(path.startsWith('M0.0 10.0')).toBe(true);
    expect(path.match(/C/g)).toHaveLength(2);
    expect(path.endsWith('100.0 10.0')).toBe(true);
  });

  test('close the area along the bottom, and draw nothing without values', () => {
    expect(smoothAreaPath([0.5, 0.5], area, [0, 1]).endsWith('L100.0 10.0 L0.0 10.0 Z')).toBe(true);
    expect(smoothPath([], area, [0, 1])).toBe('');
    expect(smoothAreaPath([], area, [0, 1])).toBe('');
  });
});
