/**
 * Replaces the tokens of a chart option: theme colours such as `@ink` and `@palette.1`, and role
 * tokens such as `@x`, which name the role's column. In a visual map, `dimension` becomes the
 * column's index, as ECharts wants.
 */
import type { Dataset, RoleColumns } from '@querent/shared';
import type { Loose } from './loose.ts';
import { oneColumn } from './roles.ts';
import type { ChartTheme } from './theme.ts';

/**
 * The red, green and blue of a hex colour, long or short, as stylesheet minifiers write them.
 *
 * @param color - Such as `#2a55c9` or `#fff`.
 * @returns The channels, or `undefined` for anything else.
 */
function channelsOf(color: string): number[] | undefined {
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(color);
  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  const parts = short ? short.slice(1).map((digit) => digit + digit) : long?.slice(1);
  return parts?.map((part) => Number.parseInt(part, 16));
}

/**
 * Mixes two hex colours.
 *
 * @param from - The first colour, such as `#2a55c9`.
 * @param to - The second colour.
 * @param share - How much of the second, from 0 to 1.
 * @returns The mixed colour, or `undefined` when either is not a hex colour.
 */
function mix(from: string, to: string, share: number): string | undefined {
  const [a, b] = [channelsOf(from), channelsOf(to)];
  if (!a || !b) return undefined;
  const mixed = a.map((value, index) => Math.round(value + ((b[index] ?? value) - value) * share));
  return `#${mixed.map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * The colour of each theme token.
 *
 * @param theme - The theme.
 * @returns The colours by token.
 */
export function themeColors(theme: ChartTheme): Record<string, string> {
  const accent = theme.palette[0] ?? theme.ink;
  const palette = Object.fromEntries(
    theme.palette.map((color, index) => [`@palette.${index}`, color]),
  );
  return {
    '@ink': theme.ink,
    '@inkSecondary': theme.inkSecondary,
    '@surface': theme.surface,
    '@border': theme.border,
    '@divider': theme.divider,
    '@scale.low': mix(theme.surface, accent, 0.12) ?? theme.divider,
    '@scale.mid': mix(theme.surface, accent, 0.45) ?? accent,
    '@scale.high': accent,
    ...palette,
  };
}

/** What replacing tokens needs. */
interface TokenContext {
  /** The colours by theme token. */
  readonly colors: Readonly<Record<string, string>>;
  /** The columns of each role. */
  readonly roles: RoleColumns;
  /** The dataset visual map dimensions refer to. */
  readonly dataset: Dataset | undefined;
}

/**
 * The value of one string token, or the string itself.
 *
 * @param text - The string.
 * @param key - The key it sits under.
 * @param context - The colours, roles and dataset.
 * @returns The replacement.
 */
function tokenValue(text: string, key: string, context: TokenContext): unknown {
  if (!text.startsWith('@')) return text;
  const color = context.colors[text];
  if (color) return color;
  const column = oneColumn(context.roles, text.slice(1));
  if (column === undefined) return text;
  if (key !== 'dimension') return column;
  return context.dataset?.dimensions.findIndex((dimension) => dimension.name === column) ?? 0;
}

/**
 * Replaces every token in a value.
 *
 * @param value - Part of an option.
 * @param context - The colours, roles and dataset.
 * @param key - The key the value sits under.
 * @returns The value with tokens replaced.
 */
export function replaceTokens(value: unknown, context: TokenContext, key = ''): unknown {
  if (typeof value === 'string') return tokenValue(value, key, context);
  if (Array.isArray(value)) return value.map((item) => replaceTokens(item, context, key));
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Loose).map(([child, item]) => [
      child,
      replaceTokens(item, context, child),
    ]),
  );
}
