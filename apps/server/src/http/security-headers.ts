/** Response headers that limit what a page served by querent can load and who can frame it. */
import type { MiddlewareHandler } from 'hono';
import { secureHeaders } from 'hono/secure-headers';

/**
 * Creates the security headers middleware (architecture, security checklist). `style-src` allows
 * inline styles because ECharts sets them.
 *
 * @returns The middleware.
 */
export function securityHeaders(): MiddlewareHandler {
  return secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      connectSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'],
      styleSrc: ["'self'", "'unsafe-inline'"],
      frameAncestors: ["'none'"],
    },
    referrerPolicy: 'same-origin',
    xFrameOptions: 'DENY',
    xContentTypeOptions: 'nosniff',
  });
}
