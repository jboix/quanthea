/** The theme tokens a recipe may use for colours, which the adapter replaces from the theme. */
export const themeTokens = [
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
] as const;

/** Tokens the fill step or the adapter fill with values: the unit's formatter, the last value. */
export const valueTokens = ['@format', '@last'] as const;
