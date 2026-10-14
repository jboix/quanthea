/**
 * Refuses a free colour in a chart's option when a spec is written: a hex, an `rgb()` or `hsl()`
 * colour anywhere, and a CSS colour name under a key that takes a colour. A chart takes theme
 * tokens, which follow the light and the dark scheme. Only a spec being written is checked, so a
 * stored version that holds a colour still pins, restores and copies.
 */
import { type DashboardSpec, themeTokens } from '@quanthea/shared';
import type { SpecIssue } from './issues.ts';

/** A colour written as a hex or a colour function. */
const colorPattern = /^\s*(#[0-9a-f]{3,8}|(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\s*\()/i;

/** The CSS colour names, as a person or a model writes them. */
const colorNames: ReadonlySet<string> = new Set(
  `aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet
  brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue
  darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange
  darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise
  darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen
  fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred
  indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan
  lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen
  lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta
  maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue
  mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin
  navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen
  paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple
  red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue
  slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet
  wheat white whitesmoke yellow yellowgreen`.split(/\s+/),
);

/** A free colour found in an option. */
interface FreeColor {
  /** Where, from the option. */
  readonly path: string;
  /** The colour as written. */
  readonly value: string;
}

/**
 * Whether a key takes a colour, such as `color`, `borderColor` or `areaColor`.
 *
 * @param key - The key.
 * @returns True for a key that ends in "color".
 */
function takesColor(key: string): boolean {
  return key.toLowerCase().endsWith('color');
}

/**
 * Whether a text is a free colour.
 *
 * @param text - The text.
 * @param underColor - Whether it sits under a key that takes a colour.
 * @returns True for a hex or a colour function, and for a colour name under such a key.
 */
function isFreeColor(text: string, underColor: boolean): boolean {
  if (colorPattern.test(text)) return true;
  return underColor && colorNames.has(text.trim().toLowerCase());
}

/**
 * The free colours of a value of an option, with their paths.
 *
 * @param value - The value.
 * @param path - Its path.
 * @param underColor - Whether it sits under a key that takes a colour.
 * @returns The free colours found.
 */
function freeColors(value: unknown, path: string, underColor: boolean): FreeColor[] {
  if (typeof value === 'string') return isFreeColor(value, underColor) ? [{ path, value }] : [];
  if (Array.isArray(value))
    return value.flatMap((item, index) => freeColors(item, `${path}[${index}]`, underColor));
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([key, item]) =>
    freeColors(item, `${path}.${key}`, underColor || takesColor(key)),
  );
}

/** What a chart takes instead of a colour, said once in every message. */
const tokensHint = `Use a theme token: ${themeTokens.join(', ')}.`;

/**
 * Checks the chart options of a spec being written for free colours.
 *
 * @param spec - The spec.
 * @returns One issue per colour found.
 */
export function checkColors(spec: DashboardSpec): SpecIssue[] {
  return spec.panels.flatMap((panel, index) => {
    if (panel.view.kind !== 'chart') return [];
    const path = `panels[${index}].view.option`;
    return freeColors(panel.view.option, path, false).map((found) => ({
      path: found.path,
      message: `A chart takes theme tokens, never a colour: "${found.value}". ${tokensHint}`,
    }));
  });
}
