/**
 * Keeps the plugin to one directory: a connector names a file relative to QUANTHEA_SQLITE_ROOT,
 * and the file, symbolic links resolved, must be inside it. Without a root, no file opens.
 */
import { realpathSync, statSync } from 'node:fs';
import { isAbsolute, resolve, sep } from 'node:path';

/** The variable that names the directory database files may be in. */
export const rootVariable = 'QUANTHEA_SQLITE_ROOT';

/**
 * Where a connector's file really is, or why it may not be opened.
 *
 * @param file - The file, as the connector names it: relative to the root.
 * @param root - The root directory, from {@link rootVariable}, if set.
 * @returns The real path, or the problem.
 */
export function resolveInRoot(
  file: string,
  root: string | undefined,
): { readonly path: string } | { readonly problem: string } {
  if (!root) return { problem: `${rootVariable} is not set: set it to the directory of the files` };
  if (isAbsolute(file) || file.split(/[/\\]/).includes('..'))
    return { problem: `name the file relative to ${rootVariable}, without ..` };
  let realRoot: string;
  let realFile: string;
  try {
    realRoot = realpathSync(root);
    realFile = realpathSync(resolve(realRoot, file));
  } catch {
    return { problem: `there is no file ${file} in ${rootVariable}` };
  }
  if (!realFile.startsWith(realRoot + sep))
    return { problem: `${file} resolves outside ${rootVariable}` };
  if (!statSync(realFile).isFile()) return { problem: `${file} is not a file` };
  return { path: realFile };
}
