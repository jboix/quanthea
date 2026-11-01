/** Response headers that limit what a page served by quanthea can load, who can frame it, and caching. */
import { apiPrefix } from '@quanthea/shared';
import type { MiddlewareHandler } from 'hono';
import { createMiddleware } from 'hono/factory';
import { secureHeaders } from 'hono/secure-headers';

/** HSTS for a year, with subdomains, sent only when quanthea is reached over HTTPS. */
const strictTransport = 'max-age=31536000; includeSubDomains';

/**
 * Creates the security headers middleware (architecture, security checklist). `style-src` allows
 * inline styles because ECharts sets them. `img-src` names the hosts an admin marked for images,
 * read on each request.
 *
 * @param publicUrl - quanthea's origin, when configured; HSTS is sent when it is HTTPS.
 * @param imageHosts - The hosts images may load from; none when left out.
 * @returns The middleware.
 */
export function securityHeaders(
  publicUrl?: string,
  imageHosts: () => readonly string[] = () => [],
): MiddlewareHandler {
  const listed = () => imageHosts().map((host) => `https://${host}`);
  return secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      connectSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', () => listed().join(' ')],
      styleSrc: ["'self'", "'unsafe-inline'"],
      objectSrc: ["'none'"],
      baseUri: ["'none'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
    },
    strictTransportSecurity: publicUrl?.startsWith('https://') ? strictTransport : false,
    permissionsPolicy: {
      camera: [],
      microphone: [],
      geolocation: [],
      payment: [],
      usb: [],
    },
    crossOriginOpenerPolicy: 'same-origin',
    crossOriginResourcePolicy: 'same-origin',
    referrerPolicy: 'same-origin',
    xFrameOptions: 'DENY',
    xContentTypeOptions: 'nosniff',
  });
}

/**
 * Marks every `/api` answer as never to be cached, by the browser or a proxy: they may hold what
 * only the signed-in person may see.
 *
 * @returns The middleware.
 */
export function noStoreApi(): MiddlewareHandler {
  return createMiddleware(async (context, next) => {
    await next();
    if (context.req.path.startsWith(`${apiPrefix}/`)) context.header('Cache-Control', 'no-store');
  });
}
