import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { toneTokens } from '../../ui/tone-tokens.ts';
import { toneStyle } from './tone.ts';

/** The stylesheet of the design tokens, split into the light and the dark scheme. */
const [light = '', dark = ''] = readFileSync(
  new URL('../../../../../packages/tokens/tokens.css', import.meta.url),
  'utf8',
).split(':root[data-theme="dark"]');

describe('the colour of a tone', () => {
  test('is a design token set in the light and in the dark scheme', () => {
    for (const token of Object.values(toneTokens)) {
      expect(light).toContain(`${token}: #`);
      expect(dark).toContain(`${token}: #`);
    }
  });

  test('is a colour of its own for each tone', () => {
    const tokens = Object.values(toneTokens);
    expect(new Set(tokens).size).toBe(tokens.length);
    expect(tokens).not.toContain('--color-brand-signal');
    expect(tokens).not.toContain('--color-draft');
  });

  test('reaches the stylesheet as a property, and a value without a tone has none', () => {
    expect<object | undefined>(toneStyle('warning')).toEqual({ '--tone': 'var(--color-warning)' });
    expect(toneStyle(undefined)).toBeUndefined();
  });
});
