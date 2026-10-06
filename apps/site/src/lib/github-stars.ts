/**
 * The repository's star count, fetched once per build from the GitHub API. Any failure (no
 * network, rate limit) gives no count, and the header shows the link without one.
 */
import { repositorySlug } from './project.ts';

/** The one request of a build. */
let request: Promise<number | undefined> | undefined;

/**
 * Fetches the count.
 *
 * @returns The number of stars, or `undefined`.
 */
async function fetchStars(): Promise<number | undefined> {
  try {
    const token = process.env.GITHUB_TOKEN;
    const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`https://api.github.com/repos/${repositorySlug}`, {
      headers,
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) return undefined;
    const body = (await response.json()) as { stargazers_count?: unknown };
    return typeof body.stargazers_count === 'number' ? body.stargazers_count : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The star count, written short (`1.2K`).
 *
 * @returns The count as text, or `undefined` when it is not known or zero.
 */
export async function starCount(): Promise<string | undefined> {
  request ??= fetchStars();
  const stars = await request;
  // A count of zero says nothing worth showing.
  if (stars === undefined || stars === 0) return undefined;
  return new Intl.NumberFormat('en', { notation: 'compact' }).format(stars);
}
