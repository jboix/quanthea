/** `llms-full.txt`: every doc's Markdown in one file, with absolute links. */
import type { APIRoute } from 'astro';
import { docPages } from '../lib/docs-content.ts';
import { llmsFull } from '../lib/llms.ts';
import { absoluteLink } from '../lib/url.ts';

/**
 * The file.
 *
 * @param context - The build context.
 * @param context.site - The site's origin.
 * @returns The text response.
 */
export const GET: APIRoute = async ({ site }) =>
  new Response(llmsFull(await docPages(), absoluteLink('', site)), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
