/**
 * Where to send a person after signing in: a local path only, so no link can send them away. The
 * server and the web app check the same rules.
 */

/** The paths a person is never sent to after signing in: the sign-in pages and the API. */
const refusedPrefixes: readonly string[] = ['/login', '/set-password', '/api/'];

/**
 * Whether a path asked for has the shape of a local path: one leading `/`, no backslash that a
 * browser might read as `/`, and no control characters.
 *
 * @param next - The path asked for.
 * @returns Whether it has that shape.
 */
function looksLocal(next: string): boolean {
  const local = next.startsWith('/') && !next.startsWith('//') && !next.includes('\\');
  return local && [...next].every((character) => character >= ' ' && character !== '\u007f');
}

/**
 * Whether the path part (before any `?` or `#`) reads the same to the browser and the server as it
 * does here: no percent-encoding, which the server decodes, and no `.` or `..` segment, which the
 * browser resolves.
 *
 * @param next - A path that looks local.
 * @returns Whether the path part is literal.
 */
function literalPath(next: string): boolean {
  const [path = ''] = next.split(/[?#]/, 1);
  const segments = path.split('/');
  return !path.includes('%') && !segments.some((segment) => segment === '.' || segment === '..');
}

/**
 * A local path, not a path of the sign-in pages or of the API, whose path part holds no
 * percent-encoding and no dot segment, so the browser and the server read it as written. Anything
 * else goes home.
 *
 * @param next - The path asked for.
 * @returns The path, or `/`.
 */
export function safeNext(next: unknown): string {
  if (typeof next !== 'string' || next.length < 1 || next.length > 2048) return '/';
  if (!looksLocal(next) || !literalPath(next)) return '/';
  return refusedPrefixes.some((prefix) => next.startsWith(prefix)) ? '/' : next;
}
