import { type Tone, tones } from '../spec/tones.ts';

/**
 * The theme token of a tone, which the adapter replaces with the tone's colour.
 *
 * @param tone - The tone.
 * @param soft - Whether to name the tint of the tone, for a track under a mark in the tone itself.
 * @returns Such as `@tone.warning`, or `@toneSoft.warning` for the tint.
 */
export function toneToken(tone: Tone, soft = false): string {
  return `${soft ? '@toneSoft' : '@tone'}.${tone}`;
}

/** The theme tokens a recipe may use for colours, which the adapter replaces from the theme. */
export const themeTokens: readonly string[] = [
  '@ink',
  '@inkSecondary',
  '@surface',
  '@border',
  '@divider',
  '@scale.low',
  '@scale.mid',
  '@scale.high',
  '@palette.0',
  '@palette.1',
  '@palette.2',
  '@palette.3',
  '@palette.4',
  '@palette.5',
  ...tones.map((tone) => toneToken(tone)),
  ...tones.map((tone) => toneToken(tone, true)),
];

/** Tokens the fill step or the adapter fill with values: the unit's formatter, the last value. */
export const valueTokens = ['@format', '@last'] as const;
