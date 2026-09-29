/** Dashboard endpoints: create from a spec, read, read a version, pin, unpin. */
import { z } from 'zod';
import { dashboardSpecSchema } from '../spec/dashboard.ts';
import { defineEndpoint } from './contract.ts';

/** Validates a version in a dashboard's history. */
const versionSummarySchema = z.object({
  version: z.int(),
  changeSummary: z.string().nullable(),
  pinnedAt: z.number().nullable(),
  actor: z.string().nullable(),
  createdAt: z.number(),
});

/** Validates a dashboard with its history. Viewers only see pinned versions in it. */
export const dashboardDetailSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  tags: z.array(z.string()),
  parentDashboardId: z.string().nullable(),
  parentVersion: z.int().nullable(),
  pinnedVersion: z.int().nullable(),
  deletedAt: z.number().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
  versions: z.array(versionSummarySchema),
});

/** A dashboard with its history. */
export type DashboardDetail = z.infer<typeof dashboardDetailSchema>;

/**
 * A dashboard as its screen reads it: with the thread that edits it, while that thread is out of
 * the bin, and whether its thread is in the bin.
 */
export const dashboardPageSchema = dashboardDetailSchema.extend({
  threadId: z.string().nullable(),
  threadBinned: z.boolean(),
});

/** A dashboard as its screen reads it. */
export type DashboardPage = z.infer<typeof dashboardPageSchema>;

/** Validates one version with its spec. */
export const dashboardVersionSchema = versionSummarySchema.extend({
  dashboardId: z.string(),
  spec: dashboardSpecSchema,
});

/** One version of a dashboard, with its spec. */
export type DashboardVersion = z.infer<typeof dashboardVersionSchema>;

/** The path parameter of one dashboard. */
const dashboardParams = z.object({ dashboardId: z.string().min(1) });

/** Creates a dashboard from a spec, as its first draft version. */
export const createDashboardEndpoint = defineEndpoint({
  method: 'POST',
  path: '/dashboards',
  body: z.object({
    spec: z.unknown(),
    changeSummary: z.string().max(200).optional(),
  }),
  output: dashboardDetailSchema,
});

/** Reads a dashboard and its history. */
export const getDashboardEndpoint = defineEndpoint({
  method: 'GET',
  path: '/dashboards/:dashboardId',
  params: dashboardParams,
  output: dashboardPageSchema,
});

/** Reads one version of a dashboard. Viewers may read pinned versions only. */
export const getDashboardVersionEndpoint = defineEndpoint({
  method: 'GET',
  path: '/dashboards/:dashboardId/versions/:version',
  params: dashboardParams.extend({ version: z.string().regex(/^[1-9]\d{0,5}$/) }),
  output: dashboardVersionSchema,
});

/**
 * Makes a version the one shown, after checking it again and test-running every panel. Any
 * version can be pinned, including one pinned before.
 */
export const pinDashboardEndpoint = defineEndpoint({
  method: 'POST',
  path: '/dashboards/:dashboardId/pin',
  params: dashboardParams,
  body: z.object({ version: z.int().min(1) }),
  output: dashboardDetailSchema,
});

/** Stops showing any version: the dashboard leaves the library, and viewers can't open it. */
export const unpinDashboardEndpoint = defineEndpoint({
  method: 'POST',
  path: '/dashboards/:dashboardId/unpin',
  params: dashboardParams,
  output: dashboardDetailSchema,
});
