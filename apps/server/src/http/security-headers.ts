/** Response headers that limit what a page served by querent can load, who can frame it, and caching. */
import { apiPrefix } from '@quanthea/shared';
import type { MiddlewareHandler } from 'hono';
import { createMiddleware } from 'hono/factory';
import { secureHeaders } from 'hono/secure-headers';

/** HSTS for a year, with subdomains, sent only when querent is reached over HTTPS. */
const strictTransport = 'max-age=31536000; includeSubDomains';

/**
 * Creates the security headers middleware (architecture, security checklist). `style-src` allows
 * inline styles because ECharts sets them.
 *
 * @param publicUrl - querent's origin, when configured; HSTS is sent when it is HTTPS.
 * @returns The middleware.
 */
export function securityHeaders(publicUrl?: string): MiddlewareHandler {
  return secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      connectSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'],
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
