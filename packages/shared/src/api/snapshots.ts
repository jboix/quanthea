/**
 * Snapshot links: a dashboard version frozen with the results its panels showed. The server runs
 * every panel itself when a snapshot is taken; the browser never sends results. Opening a snapshot
 * runs no query and calls no model.
 */
import { z } from 'zod';
import { isTimeZone } from '../reports/zoned.ts';
import { dashboardSpecSchema } from '../spec/dashboard.ts';
import { timeRangeSchema } from '../spec/time.ts';
import { variableValuesSchema } from '../spec/variables.ts';
import { defineEndpoint } from './contract.ts';
import { panelRunSchema } from './panels.ts';

/** How long a snapshot lives, as its taker picks it. */
export const snapshotLifetimes = ['1d', '7d', '30d', 'forever'] as const;

/** How long a snapshot lives. */
export type SnapshotLifetime = (typeof snapshotLifetimes)[number];

/** Validates a snapshot without its data, for lists and the snapshot's header. */
export const snapshotSummarySchema = z.object({
  /** The unguessable id in the link. */
  id: z.string(),
  dashboardId: z.string(),
  version: z.int(),
  /** The version's title when it was taken. */
  title: z.string(),
  /** The time range the panels ran over, in epoch milliseconds. */
  time: z.object({ from: z.number(), to: z.number() }),
  /** The variable values the panels ran with: the chosen ones, else the defaults. */
  variables: variableValuesSchema,
  /** The sets of markers hidden when it was taken. */
  hiddenMarkers: z.array(z.string()),
  /** The name of the person who took it. */
  takenBy: z.string(),
  takenAt: z.number(),
  /** When it goes, in epoch milliseconds; `null` when it lives until someone revokes it. */
  expiresAt: z.number().nullable(),
  /** The size of its stored spec and results, in bytes. */
  bytes: z.int(),
});

/** A snapshot without its data. */
export type SnapshotSummary = z.infer<typeof snapshotSummarySchema>;

/** Validates a snapshot with its spec and every panel's frozen run. */
export const snapshotSchema = snapshotSummarySchema.extend({
  spec: dashboardSpecSchema,
  /** Each panel's run as the dashboard showed it, by panel id. */
  panels: z.record(z.string(), panelRunSchema),
});

/** A snapshot with its spec and every panel's frozen run. */
export type Snapshot = z.infer<typeof snapshotSchema>;

/** The path parameter of one snapshot. */
const snapshotParams = z.object({ snapshotId: z.string().min(1).max(64) });

/** Validates a list of snapshots, the newest first. */
const snapshotListSchema = z.object({ snapshots: z.array(snapshotSummarySchema) });

/**
 * Takes a snapshot of a saved version, as the dashboard shows it: the server resolves the time
 * range to absolute times and runs every panel with the variables.
 */
export const takeSnapshotEndpoint = defineEndpoint({
  method: 'POST',
  path: '/snapshots',
  body: z.object({
    dashboardId: z.string().min(1),
    version: z.int().min(1),
    variables: variableValuesSchema.default({}),
    /** The time range as shown; the spec's default when omitted. */
    time: timeRangeSchema.optional(),
    hiddenMarkers: z.array(z.string().max(64)).max(20).default([]),
    lifetime: z.enum(snapshotLifetimes),
  }),
  output: snapshotSummarySchema,
});

/** Opens a live snapshot. An unknown, revoked or expired one is "not found". */
export const getSnapshotEndpoint = defineEndpoint({
  method: 'GET',
  path: '/snapshots/:snapshotId',
  params: snapshotParams,
  output: snapshotSchema,
});

/** Lists the live snapshots of one dashboard. */
export const listDashboardSnapshotsEndpoint = defineEndpoint({
  method: 'GET',
  path: '/dashboards/:dashboardId/snapshots',
  params: z.object({ dashboardId: z.string().min(1) }),
  output: snapshotListSchema,
});

/**
 * The Library's snapshot filters: every listed snapshot, those that go within seven days, and
 * those kept until someone revokes them.
 */
export const snapshotFilters = ['all', 'expiring', 'kept'] as const;

/** One of the Library's snapshot filters. */
export type SnapshotFilter = (typeof snapshotFilters)[number];

/** Validates the Library's search of snapshots. */
export const snapshotQuerySchema = z.object({
  /** Words that must each match the title, the version, the taker or the period. */
  q: z.string().max(200).optional(),
  filter: z.enum(snapshotFilters).default('all'),
  /** The time zone the period is written in for the search; the server's when left out. */
  timeZone: z.string().max(64).refine(isTimeZone, 'Unknown time zone.').optional(),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/** The Library's search of snapshots. */
export type SnapshotQuery = z.infer<typeof snapshotQuerySchema>;

/**
 * Lists the live snapshots the caller may see, the newest first, for the Library: those of a
 * version everyone sees, and those of a draft the caller may see. Expired and revoked ones are
 * never listed.
 */
export const searchSnapshotsEndpoint = defineEndpoint({
  method: 'GET',
  path: '/snapshots',
  query: snapshotQuerySchema,
  output: snapshotListSchema.extend({
    /** How many match, over every page. */
    total: z.int(),
  }),
});

/** Revokes a snapshot before its time: its link stops working at once. */
export const revokeSnapshotEndpoint = defineEndpoint({
  method: 'DELETE',
  path: '/snapshots/:snapshotId',
  params: snapshotParams,
  output: z.object({ revoked: z.literal(true) }),
});
