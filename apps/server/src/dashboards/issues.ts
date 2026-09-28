/** Problems found in a spec, with paths the model and the UI can point at. */

/** One problem in a spec. */
export interface SpecIssue {
  /** Where it is, such as `panels[3].view.ref`. */
  readonly path: string;
  /** What is wrong. */
  readonly message: string;
}

/**
 * Writes a path the way the spec document does: indexes in brackets, keys after dots.
 *
 * @param segments - The keys and indexes from the root.
 * @returns Such as `panels[3].view.ref`, or `spec` for the root.
 */
export function pathOf(segments: readonly PropertyKey[]): string {
  const path = segments
    .map((segment) => (typeof segment === 'number' ? `[${segment}]` : `.${String(segment)}`))
    .join('')
    .replace(/^\./, '');
  return path === '' ? 'spec' : path;
}
