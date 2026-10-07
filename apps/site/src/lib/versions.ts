/**
 * The versions of the docs the site serves: the latest patch of each released minor from v0.3 on,
 * read from the git tags, and `next`, the docs of `main`. The latest release lives at `docs/`, an
 * older one at `docs/vX.Y/`, and `next` at `docs/next/`. The repository holds the current docs only;
 * the prebuild (`scripts/versions.ts`) extracts each kept release's from its tag.
 */
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** A released version the site serves, as the prebuild extracted it. */
export interface ReleasedVersion {
  /** Its id and path segment, such as `v0.4`. */
  readonly id: string;
  /** The tag its docs come from, such as `v0.4.2`. */
  readonly tag: string;
}

/** A version of the docs, as the pages use it. */
export interface DocVersion {
  /** Its id: `v0.4`, or `next` for `main`. */
  readonly id: string;
  /** What the menu says under its id, such as `Latest release`. */
  readonly note: string;
  /** The site path of its docs, such as `docs/`, `docs/v0.3/` or `docs/next/`. */
  readonly path: string;
  /** The git ref its sources link to on GitHub: a tag, or `main`. */
  readonly ref: string;
  /** Whether it is the latest release, which `docs/` shows. */
  readonly latest: boolean;
  /** Whether it is `next`, the docs of `main`. */
  readonly next: boolean;
}

/** The first minor whose docs the site serves: earlier releases had no user docs. */
const firstMinor = { major: 0, minor: 3 };

/** A release tag, such as `v0.4.2`. */
const releaseTag = /^v(\d+)\.(\d+)\.(\d+)$/;

/** A release tag read into numbers. */
interface Release {
  /** The tag, such as `v0.4.2`. */
  readonly tag: string;
  /** Its minor's id, such as `v0.4`. */
  readonly id: string;
  /** Its major, minor and patch. */
  readonly numbers: readonly [number, number, number];
}

/**
 * A tag read as a release the site serves docs for.
 *
 * @param tag - The tag.
 * @returns The release, or `undefined` for another tag or a release before v0.3.
 */
function releaseOf(tag: string): Release | undefined {
  const match = releaseTag.exec(tag);
  if (!match) return undefined;
  const numbers = match.slice(1).map(Number) as [number, number, number];
  const [major, minor] = numbers;
  const before =
    major < firstMinor.major || (major === firstMinor.major && minor < firstMinor.minor);
  return before ? undefined : { tag, id: `v${major}.${minor}`, numbers };
}

/**
 * Compares releases, newest first.
 *
 * @param first - One release.
 * @param second - The other.
 * @returns Negative when the first is newer.
 */
function newestFirst(first: Release, second: Release): number {
  const [a, b] = [first.numbers, second.numbers];
  return b[0] - a[0] || b[1] - a[1] || b[2] - a[2];
}

/**
 * The versions to serve, newest first: the latest patch of each minor from v0.3 on.
 *
 * @param tags - The repository's tags.
 * @returns The versions, each with its id and tag.
 */
export function pickVersions(tags: readonly string[]): ReleasedVersion[] {
  const releases = tags.flatMap((tag) => releaseOf(tag) ?? []).sort(newestFirst);
  // Newest first, so the first release of each minor is its latest patch.
  const latest = releases.filter(
    (release, index) => releases.findIndex((other) => other.id === release.id) === index,
  );
  return latest.map(({ id, tag }) => ({ id, tag }));
}

/**
 * Where the prebuild writes each version's docs and the list of them: `.versions/` in the site's
 * folder. It is found from the working directory, which the site's scripts and Astro run in,
 * because Astro bundles this module elsewhere and its own address no longer leads there.
 */
export const versionsDir = pathToFileURL(`${process.cwd()}/.versions/`);

/**
 * The released versions the prebuild extracted, newest first; none when it has not run.
 *
 * @returns The versions.
 */
export function releasedVersions(): ReleasedVersion[] {
  const list = new URL('versions.json', versionsDir);
  if (!existsSync(list)) return [];
  return JSON.parse(readFileSync(list, 'utf8')) as ReleasedVersion[];
}

/**
 * Every version of the docs the site serves, in the menu's order: `next`, the latest release, then
 * the older ones. Without a release, `next` takes `docs/` itself.
 *
 * @param released - The released versions, newest first.
 * @returns The versions.
 */
export function docVersions(released: readonly ReleasedVersion[]): DocVersion[] {
  const releases = released.map((version, index) => ({
    id: version.id,
    note: index === 0 ? 'Latest release' : 'Older release',
    path: index === 0 ? 'docs/' : `docs/${version.id}/`,
    ref: version.tag,
    latest: index === 0,
    next: false,
  }));
  const next = {
    id: 'next',
    note: 'Unreleased, on main',
    path: releases.length === 0 ? 'docs/' : 'docs/next/',
    ref: 'main',
    latest: releases.length === 0,
    next: true,
  };
  return [next, ...releases];
}
