/** Facts about the project itself, read from the root `package.json` at build time. */
import rootPackage from '../../../../package.json' with { type: 'json' };

/** The released version, such as `0.2.0`. */
export const version: string = rootPackage.version;

/** The one-sentence description of quanthea. */
export const description: string = rootPackage.description;

/** The repository's web address on GitHub, such as `https://github.com/jboix/quanthea`. */
export const repositoryUrl: string = rootPackage.repository.url
  .replace(/^git\+/, '')
  .replace(/\.git$/, '');

/** The branch the site links source files on, unless a version names its tag. */
export const branch = 'main';

/** The owner and name of the repository, such as `jboix/quanthea`. */
export const repositorySlug: string = new URL(repositoryUrl).pathname.replace(/^\//, '');

/**
 * The GitHub address of a repository path.
 *
 * @param repoPath - The path from the repository root, such as `deploy/` or `AGENTS.md`.
 * @param ref - The branch or tag, `main` by default.
 * @returns A `tree` address for a directory, a `blob` address for a file.
 */
export function githubUrl(repoPath: string, ref: string = branch): string {
  const name = repoPath.replace(/\/$/, '').split('/').pop() ?? '';
  // Directories are lower case without a dot; LICENSE and Dockerfile are files.
  const isFile = !repoPath.endsWith('/') && (name.includes('.') || /^[A-Z]/.test(name));
  const kind = isFile ? 'blob' : 'tree';
  return `${repositoryUrl}/${kind}/${ref}/${repoPath.replace(/\/$/, '')}`;
}

/**
 * The raw address of a repository file, for images in text read off the site.
 *
 * @param repoPath - The file's path from the repository root.
 * @param ref - The branch or tag, `main` by default.
 * @returns The raw address.
 */
export function githubRawUrl(repoPath: string, ref: string = branch): string {
  return `https://raw.githubusercontent.com/${repositorySlug}/${ref}/${repoPath}`;
}
