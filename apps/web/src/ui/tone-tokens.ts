/**
 * The design token of each tone, from `@quanthea/tokens`: a tone names a colour of the theme, so a
 * toned value follows the light and the dark scheme.
 */
import type { Tone } from '@quanthea/shared';

/** The design token of each tone. */
export const toneTokens: Readonly<Record<Tone, string>> = {
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
