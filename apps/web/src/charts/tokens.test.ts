import { describe, expect, test } from 'bun:test';
import { defaultTheme } from './theme.ts';
import { replaceTokens, textOn, themeColors } from './tokens.ts';

/** The dark scheme's colours, as `ui/theme.css` sets them. */
const darkTheme = {
  ...defaultTheme,
  palette: ['#7f9ff2', '#e8873e', '#4db3a5', '#ab82e3', '#d9ab2e', '#e46a90'],
  ink: '#ecebe6',
  surface: '#1b1c20',
};

/** Every colour a set of markers may take. */
const markerTokens = ['@ink', ...defaultTheme.palette.map((_, index) => `@palette.${index}`)];

describe('chart tokens', () => {
  test('mix colour scales from short hex colours, as minified stylesheets write them', () => {
    const colors = themeColors({ ...defaultTheme, surface: '#fff' });
    expect(colors['@scale.low']).toBe('#e5ebf9');
    expect(colors['@scale.high']).toBe(defaultTheme.palette[0]);
  });

  test('name columns for roles and turn a visual map dimension into a column index', () => {
    const dataset = {
      dimensions: [
        { name: 'x', type: 'number' as const },
        { name: 'errors', type: 'number' as const },
      ],
      source: [],
    };
    const context = { colors: themeColors(defaultTheme), roles: { color: 'errors' }, dataset };
    expect(
      replaceTokens({ name: '@color', visualMap: { dimension: '@color' }, line: '@ink' }, context),
    ).toEqual({
      name: 'errors',
      visualMap: { dimension: 1 },
      line: defaultTheme.ink,
    });
  });

  test('write on each marker colour in the ink or the surface, whichever reads better', () => {
    const light = markerTokens.map((token) => textOn(token, defaultTheme));
    const { ink, surface } = defaultTheme;
    expect(light).toEqual([surface, surface, ink, ink, surface, ink, surface]);
    const dark = markerTokens.map((token) => textOn(token, darkTheme));
    expect(dark).toEqual(markerTokens.map(() => darkTheme.surface));
    expect(textOn('rgb(0 0 0)', defaultTheme)).toBe(surface);
  });
});
