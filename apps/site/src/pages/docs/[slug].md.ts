/**
 * Each doc's Markdown at `docs/<slug>.md`, for tools and models that read Markdown. Its links are
 * absolute: to the site's pages for published docs, to GitHub for the rest of the repository.
 */
import type { APIRoute, GetStaticPaths } from 'astro';
import { type DocPage, docPages, pageMarkdown } from '../../lib/docs-content.ts';
import { absoluteLink } from '../../lib/url.ts';

/**
 * One file per docs page.
 *
 * @returns The paths and their pages.
 */
export const getStaticPaths: GetStaticPaths = async () =>
  (await docPages()).map((page) => ({ params: { slug: page.slug }, props: { page } }));

/**
 * The file.
 *
 * @param context - The build context.
 * @param context.props - The page.
 * @param context.site - The site's origin.
 * @returns The Markdown response.
 */
export const GET: APIRoute = ({ props, site }) => {
  const markdown = pageMarkdown(props.page as DocPage, absoluteLink('', site));
  return new Response(`${markdown}\n`, {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  });
};
