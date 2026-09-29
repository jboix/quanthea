import { describe, expect, test } from 'bun:test';
import { defaultTheme } from './theme.ts';
import { replaceTokens, themeColors } from './tokens.ts';

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
});
