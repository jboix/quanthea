/**
 * The paths an HTTP connector may call: patterns the admin sets, where `*` matches within one
 * segment and `**` matches across segments.
 */

/**
 * The shape of a path: absolute, without a query, a fragment, a backslash or a control character
 * (URL parsing drops tab and newlines, which would join `.\t.` into `..`).
 */
const pathShape = /^\/(?!\/)[^?#\\\p{Cc}]*$/u;

/** A dot segment as URL parsing reads it: `.` or `..`, each dot also written `%2e`. */
const dotSegment = /^(?:\.|%2e){1,2}$/i;

/**
 * A slash or a backslash written as an escape. URL parsing keeps it inside its segment, but a
 * server or a proxy that decodes it first reads a separator, and a `..` beside it as a segment.
 */
const encodedSeparator = /%2f|%5c/gi;

/**
 * Whether a segment is a dot segment once its path parameters are left out: some servers read
 * `..;x=1` as `..`.
 *
 * @param segment - One segment of a path, encoded.
 * @returns `true` for `.` or `..`, alone or before a `;`.
 */
function isDotSegment(segment: string): boolean {
  return dotSegment.test(segment.replace(/%3b/gi, ';').split(';')[0] ?? '');
}

/**
 * Whether a path is one a request may name as it is: of the shape above, without an empty segment
 * inside (`/a//b`), and without a dot segment, which URL parsing would resolve against its
 * parent, or one between encoded separators or before a `;`, which a server that decodes them
 * would. A query's path and the target of a redirect pass the same test.
 *
 * @param path - The path, encoded.
 * @returns `true` when the path is plain.
 */
export function isPlainPath(path: string): boolean {
  if (!pathShape.test(path)) return false;
  if (path.split('/').slice(1, -1).includes('')) return false;
  return !path.replace(encodedSeparator, '/').split('/').some(isDotSegment);
}

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
 * The path of a URL relative to the base URL: what the path rules check.
 *
 * @param baseUrl - The connector's base URL.
 * @param url - A parsed URL, its `.` and `..` segments resolved.
 * @returns The path with the base path removed, starting with `/`, or `undefined` when the URL
 *   leaves the base path or the origin.
 */
export function pathOfUrl(baseUrl: string, url: URL): string | undefined {
  const base = new URL(baseUrl);
  const basePath = base.pathname.replace(/\/+$/, '');
  if (url.origin !== base.origin) return undefined;
  if (url.pathname === basePath) return '/';
  if (!url.pathname.startsWith(`${basePath}/`)) return undefined;
  return url.pathname.slice(basePath.length);
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
  return pathOfUrl(baseUrl, new URL(`${base.href.replace(/\/+$/, '')}${path}`));
}
