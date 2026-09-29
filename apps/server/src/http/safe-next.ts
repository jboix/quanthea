/** Where to send a person after signing in: a local path only, so no link can send them away. */

/**
 * A local path: one leading `/`, not a path of the sign-in pages, no control characters, and no
 * backslash that a browser might read as `/`.
 *
 * @param next - The path asked for.
 * @returns The path, or `/`.
 */
export function safeNext(next: unknown): string {
  if (typeof next !== 'string' || next.length < 1 || next.length > 2048) return '/';
  const local = next.startsWith('/') && !next.startsWith('//') && !next.includes('\\');
  const plain = [...next].every((character) => character >= ' ' && character !== '\u007f');
  const signIn =
    next.startsWith('/login') || next.startsWith('/set-password') || next.startsWith('/api/');
  return local && plain && !signIn ? next : '/';
}
