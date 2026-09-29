/** The usage report: what the model steps spent, and how often pinned dashboards were viewed. */
import { usageReportEndpoint } from '@querent/shared';
import type { Hono } from 'hono';
import type { Usage } from '../../usage/usage.ts';
import type { AppEnv } from '../app-env.ts';
import { mountEndpoint } from '../endpoint.ts';

/**
 * Mounts the usage report, for admins.
 *
 * @param app - The app.
 * @param usage - The usage ledger.
 */
export function mountUsageEndpoints(app: Hono<AppEnv>, usage: Usage): void {
  mountEndpoint(app, usageReportEndpoint, {
    access: 'admin',
    handle: ({ query }) => usage.report(query.days),
  });
}
