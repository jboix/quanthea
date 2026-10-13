/**
 * The colour of a tone: the design token it names, so a toned value follows the light and the
 * dark scheme and a spec never holds a colour.
 */
import type { Tone } from '@quanthea/shared';
import type { CSSProperties } from 'react';

/** The design token of each tone, from `@quanthea/tokens`. */
export const toneTokens: Record<Tone, string> = {
  neutral: '--color-ink-secondary',
  good: '--color-ok',
  warning: '--color-warning',
  bad: '--color-danger',
  series1: '--color-accent',
  series2: '--color-series-2',
  series3: '--color-series-3',
  series4: '--color-series-4',
  series5: '--color-series-5',
  series6: '--color-series-6',
  series7: '--color-series-7',
  series8: '--color-series-8',
};

/**
 * The style that hands a tone's colour to the stylesheet, as the `--tone` property.
 *
 * @param tone - The tone, if the value has one.
 * @returns The style, or `undefined` for a value without a tone.
 */
export function toneStyle(tone: Tone | undefined): CSSProperties | undefined {
  if (!tone) return undefined;
  return { '--tone': `var(${toneTokens[tone]})` } as CSSProperties;
}
