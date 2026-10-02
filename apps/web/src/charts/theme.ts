/** The chart theme, read from the design tokens in `ui/theme.css`. */
import { type ResolvedScheme, useResolvedScheme } from '../ui/color-scheme.ts';

/** The colours and fonts a chart uses. */
export interface ChartTheme {
  /** Series colours, in order. */
  readonly palette: readonly string[];
  /** Strong text. */
  readonly ink: string;
  /** Axis labels and legends. */
  readonly inkSecondary: string;
  /** Axis lines. */
  readonly border: string;
  /** Grid lines. */
  readonly divider: string;
  /** Tooltip background. */
  readonly surface: string;
  /** Text font. */
  readonly fontFamily: string;
  /** Font for numbers on axes. */
  readonly monoFamily: string;
}

/** The theme when no stylesheet is available, matching `ui/theme.css`. */
export const defaultTheme: ChartTheme = {
  palette: ['#2a55c9', '#d0691c', '#2f8f83', '#8a55c4', '#b8870b', '#c2436b'],
  ink: '#17181c',
  inkSecondary: '#55575e',
  border: '#e2e0d9',
  divider: '#f2f0ea',
  surface: '#ffffff',
  fontFamily: "'IBM Plex Sans Variable', system-ui, sans-serif",
  monoFamily: "'IBM Plex Mono', ui-monospace, monospace",
};

/** The tokens each theme colour comes from. */
const tokens = {
  ink: '--color-ink',
  inkSecondary: '--color-ink-secondary',
  border: '--color-border',
  divider: '--color-divider',
  surface: '--color-surface',
  fontFamily: '--font-sans',
  monoFamily: '--font-mono',
} as const;

/**
 * Reads the theme from the tokens on an element.
 *
 * @param element - An element under `:root`, usually the document element.
 * @returns The theme; tokens that are not set keep their default.
 */
export function readTheme(element: Element): ChartTheme {
  const style = getComputedStyle(element);
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  const palette = defaultTheme.palette.map((color, index) =>
    read(index === 0 ? '--color-accent' : `--color-series-${index + 1}`, color),
  );
  const entries = Object.entries(tokens).map(([key, token]) => [
    key,
    read(token, defaultTheme[key as keyof typeof tokens]),
  ]);
  return { ...defaultTheme, ...Object.fromEntries(entries), palette };
}

/** The theme of each scheme, read once the scheme is showing. */
const themes = new Map<ResolvedScheme, ChartTheme>();

/**
 * The chart theme of the scheme the page shows, so charts redraw when the scheme changes.
 *
 * @returns The theme.
 */
export function useChartTheme(): ChartTheme {
  const scheme = useResolvedScheme();
  const theme = themes.get(scheme) ?? readTheme(document.documentElement);
  themes.set(scheme, theme);
  return theme;
}
