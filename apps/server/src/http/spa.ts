/** Serves the built SPA: static files, and `index.html` for every client route. */
import { join } from 'node:path';
import { apiPrefix } from '@quanthea/shared';
import type { Context, Hono, MiddlewareHandler, Next } from 'hono';
import { serveStatic } from 'hono/bun';
import type { AppEnv } from './app-env.ts';

/** Vite puts content-hashed files here, so they never change under the same name. */
const hashedAssetsPrefix = '/assets/';

/**
 * Whether a path belongs to the API, which the SPA handlers must leave alone.
 *
 * @param path - The request path.
 * @returns `true` for `/api` and everything under it.
 */
function isApiPath(path: string): boolean {
  return path === apiPrefix || path.startsWith(`${apiPrefix}/`);
}

/**
 * Wraps a middleware so it skips API paths.
 *
 * @param middleware - The middleware to run for every other path.
 * @returns The wrapped middleware.
 */
function outsideApi(middleware: MiddlewareHandler<AppEnv>): MiddlewareHandler<AppEnv> {
  return (context: Context<AppEnv>, next: Next) =>
    isApiPath(context.req.path) ? next() : middleware(context, next);
}

/**
 * Sets how long browsers may cache a static file: forever for hashed assets, never for the rest.
 *
 * @param requestPath - The request path of the served file.
 * @param context - The request context.
 */
function setCacheControl(requestPath: string, context: Context<AppEnv>): void {
  const immutable = requestPath.startsWith(hashedAssetsPrefix);
  context.header('Cache-Control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache');
}

/**
 * Serves `index.html` so the client router can handle the path. Answers 503 when the SPA has not
 * been built.
 *
 * @param webDir - The directory holding the built SPA.
 * @returns The fallback handler.
 */
function serveIndexHtml(webDir: string): MiddlewareHandler<AppEnv> {
  const indexFile = Bun.file(join(webDir, 'index.html'));
  return async (context) => {
    if (!(await indexFile.exists())) {
      return context.text('The web app is not built. Run `bun run build`.', 503);
    }
    context.header('Cache-Control', 'no-cache');
    return context.html(await indexFile.text());
  };
}

/**
 * Mounts the SPA on every GET outside `/api`. Mount it after the API routes.
 *
 * @param app - The app to mount on.
 * @param webDir - The directory holding the built SPA (`apps/web/dist`).
 */
export function mountSpa(app: Hono<AppEnv>, webDir: string): void {
  const staticFiles = serveStatic<AppEnv>({
    root: webDir,
    onFound: (_filePath, context) => setCacheControl(context.req.path, context),
  });
  app.get('*', outsideApi(staticFiles), outsideApi(serveIndexHtml(webDir)));
}
