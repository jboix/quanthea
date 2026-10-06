/**
 * Reads token values out of `@quanthea/tokens` at build time, for the few places that need a
 * colour as a literal rather than a `var(…)`, such as `<meta name="theme-color">`.
 */
import tokensCss from '@quanthea/tokens/tokens.css?raw';

/** Where the dark scheme's block starts. */
const darkBlockStart = ':root[data-theme="dark"]';

/**
 * The value of a token in one scheme.
 *
 * @param css - The stylesheet.
 * @param name - The custom property, such as `--color-ground`.
 * @param scheme - `light` reads the `:root` block, `dark` the dark block.
 * @returns The value as written.
 */
export function tokenValueIn(css: string, name: string, scheme: 'light' | 'dark'): string {
  const start = css.indexOf(darkBlockStart);
  const block = scheme === 'light' ? css.slice(0, start) : css.slice(start);
  const value = new RegExp(`${name}:\\s*([^;]+);`).exec(block)?.[1];
  if (value === undefined) throw new Error(`The token ${name} has no ${scheme} value.`);
  return value.trim();
}

/**
 * The value of a token of `@quanthea/tokens` in one scheme.
 *
 * @param name - The custom property.
 * @param scheme - The scheme.
 * @returns The value.
 */
export function tokenValue(name: string, scheme: 'light' | 'dark'): string {
  return tokenValueIn(tokensCss, name, scheme);
}
