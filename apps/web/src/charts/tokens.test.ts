import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { themeTokens } from '@quanthea/shared';
import { type ChartTheme, defaultTheme, readTheme } from './theme.ts';
import { replaceTokens, textOn, themeColors } from './tokens.ts';

/** The dark scheme's colours, as `@quanthea/tokens` sets them. */
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

/** The stylesheet of the design tokens, split into the light and the dark scheme. */
const [lightSheet = '', darkSheet = ''] = readFileSync(
  new URL('../../../../packages/tokens/tokens.css', import.meta.url),
  'utf8',
).split(':root[data-theme="dark"]');

/**
 * The theme a page reads under one scheme of the design tokens.
 *
 * @param sheet - The declarations of the scheme.
 * @returns The theme, read as the page reads it.
 */
function themeOf(sheet: string): ChartTheme {
  const declared = new Map(
    [...sheet.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((found) => [found[1], found[2]]),
  );
  const style = { getPropertyValue: (name: string) => declared.get(name) ?? '' };
  const scope = globalThis as { getComputedStyle?: unknown };
  scope.getComputedStyle = () => style;
  try {
    return readTheme({} as Element);
  } finally {
    delete scope.getComputedStyle;
  }
}

describe('the chart theme', () => {
  test('without a stylesheet has the colours of the light scheme', () => {
    const { fontFamily: _text, monoFamily: _mono, ...colors } = themeOf(lightSheet);
    expect(defaultTheme).toMatchObject(colors);
  });

  test('gives every theme token a colour in the light and in the dark scheme', () => {
    for (const theme of [themeOf(lightSheet), themeOf(darkSheet)]) {
      const colors = themeColors(theme);
      for (const token of themeTokens) expect(colors[token]).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  test('draws a tone in its design token, and its tint between the tone and the surface', () => {
    const [light, dark] = [themeColors(themeOf(lightSheet)), themeColors(themeOf(darkSheet))];
    expect([light['@tone.warning'], dark['@tone.warning']]).toEqual(['#9a6700', '#f2c94c']);
    expect([light['@tone.series1'], dark['@tone.series7']]).toEqual(['#2a55c9', '#a3c14a']);
    expect(light['@toneSoft.bad']).toBe('#ddbfbb');
    expect(dark['@toneSoft.bad']).not.toBe(light['@toneSoft.bad']);
  });
});
