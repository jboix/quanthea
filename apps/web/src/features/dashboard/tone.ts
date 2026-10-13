/**
 * The colour of a tone: the design token it names, so a toned value follows the light and the
 * dark scheme and a spec never holds a colour.
 */
import type { Tone } from '@quanthea/shared';
import type { CSSProperties } from 'react';
import { toneTokens } from '../../ui/tone-tokens.ts';

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
