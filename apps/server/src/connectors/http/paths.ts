/**
 * The paths an HTTP connector may call: patterns the admin sets, where `*` matches within one
 * segment and `**` matches across segments.
 */

/** A compiled set of path patterns. */
export interface PathRules {
  /**
   * Whether a path is allowed.
   *
   * @param path - The encoded path, without a query.
   * @returns `true` when a pattern matches it.
   */
  allows(path: string): boolean;
}

/**
 * Compiles one pattern.
 *
 * @param pattern - Such as `/api/v1/**`, or `/services/*` and a segment after it.
 * @returns The regular expression.
 */
function compile(pattern: string): RegExp {
  const parts = pattern.split(/(\*\*|\*)/).map((part) => {
    if (part === '**') return '.*';
    if (part === '*') return '[^/]*';
    return part.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  });
  return new RegExp(`^${parts.join('')}$`);
}

/**
 * Compiles the patterns of a connector.
 *
 * @param patterns - Patterns separated by commas or new lines; empty allows every path.
 * @returns The rules.
 */
export function pathRules(patterns: string): PathRules {
  const list = patterns
    .split(/[,\n]/)
    .map((pattern) => pattern.trim())
    .filter(Boolean);
  const compiled = (list.length > 0 ? list : ['/**']).map(compile);
  return { allows: (path) => compiled.some((pattern) => pattern.test(path)) };
}

/**
 * The path a request reaches, relative to the base URL: what the path rules check. URL parsing
 * resolves `.` and `..` segments (`%2e` included) first, as the request will.
 *
 * @param baseUrl - The connector's base URL.
 * @param path - The request path under it, encoded.
 * @returns The resolved path with the base path removed, starting with `/`, or `undefined` when it
 *   leaves the base path or the origin.
 */
export function pathUnderBase(baseUrl: string, path: string): string | undefined {
  const base = new URL(baseUrl);
  const basePath = base.pathname.replace(/\/+$/, '');
  const url = new URL(`${base.href.replace(/\/+$/, '')}${path}`);
  if (url.origin !== base.origin) return undefined;
  if (url.pathname === basePath) return '/';
  if (!url.pathname.startsWith(`${basePath}/`)) return undefined;
  return url.pathname.slice(basePath.length);
}
