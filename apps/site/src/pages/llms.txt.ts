/** `llms.txt`: what quanthea is and where each doc's Markdown is, for language models. */
import type { APIRoute } from 'astro';
import { docPages } from '../lib/docs-content.ts';
import { llmsIndex } from '../lib/llms.ts';
import { absoluteLink } from '../lib/url.ts';

/**
 * The file.
 *
 * @param context - The build context.
 * @param context.site - The site's origin.
 * @returns The text response.
 */
export const GET: APIRoute = async ({ site }) =>
  new Response(llmsIndex(await docPages(), absoluteLink('', site)), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
