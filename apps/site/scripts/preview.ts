/**
 * `bun run site:preview`: serves the built site, `dist/`, the way GitHub Pages serves it, on
 * http://localhost:4321. A folder answers with its `index.html`; a folder asked for without its
 * final slash redirects to it, as Pages does; any other missing path gets `404.html` with a 404.
 * The search works here, since the build writes its index into `dist/`.
 */
import { existsSync, statSync } from 'node:fs';
import { join, normalize } from 'node:path';

/** The built site. */
const dist = normalize(new URL('../dist/', import.meta.url).pathname);

/** What a path of the site answers with. */
type Answer =
  | { readonly kind: 'file'; readonly path: string }
  | { readonly kind: 'redirect'; readonly to: string }
  | { readonly kind: 'missing' };

/**
 * What GitHub Pages would answer for a path.
 *
 * @param pathname - The address's path, such as `/docs/alerts`.
 * @returns The file to serve, the address to redirect to, or that nothing lives there.
 */
function answerFor(pathname: string): Answer {
  const target = normalize(join(dist, decodeURIComponent(pathname)));
  if (!target.startsWith(dist) || !existsSync(target)) return { kind: 'missing' };
  if (statSync(target).isFile()) return { kind: 'file', path: target };
  if (!pathname.endsWith('/')) return { kind: 'redirect', to: `${pathname}/` };
  const index = join(target, 'index.html');
  return existsSync(index) ? { kind: 'file', path: index } : { kind: 'missing' };
}

/**
 * The response for a request.
 *
 * @param request - The request.
 * @returns The file, the redirect, or the site's 404 page.
 */
function respond(request: Request): Response {
  const url = new URL(request.url);
  const answer = answerFor(url.pathname);
  if (answer.kind === 'file') return new Response(Bun.file(answer.path));
  if (answer.kind === 'redirect') return Response.redirect(`${answer.to}${url.search}`, 301);
  const notFound = Bun.file(join(dist, '404.html'));
  return new Response(notFound, { status: 404, headers: { 'Content-Type': 'text/html' } });
}

if (!existsSync(join(dist, 'index.html'))) {
  process.stderr.write('No built site: run bun run site:build first.\n');
  process.exit(1);
}
const server = Bun.serve({ port: Number(process.env.PORT ?? 4321), fetch: respond });
process.stdout.write(`The built site is at http://localhost:${server.port}/\n`);
