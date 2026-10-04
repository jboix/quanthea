/**
 * Report runs as the API returns them: the period a run covered, its status, its headline numbers
 * and, for one run, its frozen results. Opening a run runs no query.
 */
import { z } from 'zod';
import { headlineSchema } from '../reports/headline.ts';
import { reportSpecSchema } from '../spec/report.ts';
import { variableValuesSchema } from '../spec/variables.ts';
import { sendResultSchema } from './notification-channels.ts';
import { panelRunSchema } from './panels.ts';

/** A run's status: running (or waiting to try again), done, or failed after its retries. */
export const reportRunStatuses = ['running', 'ok', 'failed'] as const;

/** A run's status. */
export type ReportRunStatus = (typeof reportRunStatuses)[number];

/** What started a run: the schedule, or an editor's Run now. */
export const reportRunTriggers = ['schedule', 'manual'] as const;

/** Validates a window with its name. */
export const periodViewSchema = z.object({
  /** The first instant, in epoch milliseconds. */
  from: z.number(),
  /** The last instant, in epoch milliseconds. */
  to: z.number(),
  /** Such as `week 40, 29 Sep – 5 Oct`. */
  label: z.string(),
});

/** Validates a run without its results, for lists. */
export const reportRunSummarySchema = z.object({
  id: z.string(),
  reportId: z.string(),
  version: z.int(),
  trigger: z.enum(reportRunTriggers),
  status: z.enum(reportRunStatuses),
  /** The attempts made so far. */
  attempts: z.int(),
  /** When it tries again, while it waits to. */
  retryAt: z.number().nullable(),
  /** Why the last attempt failed: quanthea's own words, which quote no secret. */
  error: z.string().nullable(),
  period: periodViewSchema,
  /** The period it compares with, or `null` without one. */
  comparison: periodViewSchema.nullable(),
  /** The headline numbers, in the report's order; empty until it succeeds. */
  headlines: z.array(headlineSchema),
  /** The name of the editor who ran it by hand; `null` for the schedule. */
  startedBy: z.string().nullable(),
  createdAt: z.number(),
  /** When the last attempt ended. */
  ranAt: z.number().nullable(),
  /** When its message went to the channels. */
  sentAt: z.number().nullable(),
});

/** A run without its results. */
export type ReportRunSummary = z.infer<typeof reportRunSummarySchema>;

/** Validates a neighbouring run, by period. */
const neighbourSchema = z.object({ id: z.string(), period: periodViewSchema });

/** Validates a link to a pinned dashboard, opened on the run's period. */
const seeAlsoLinkSchema = z.object({
  dashboardId: z.string(),
  label: z.string(),
  /** The dashboard's page on the period, a path such as `/d/<id>?from=…&to=…`. */
  path: z.string(),
});

/** Validates one run with its frozen results. */
export const reportRunDetailSchema = reportRunSummarySchema.extend({
  /** The spec of the version it ran. */
  spec: reportSpecSchema,
  /** The variable values it ran with: the defaults. */
  variables: variableValuesSchema,
  /** Each panel's run over the period, by panel id; `null` until it succeeds. */
  panels: z.record(z.string(), panelRunSchema).nullable(),
  /** Each panel's run over the comparison period; `null` without one. */
  comparisonPanels: z.record(z.string(), panelRunSchema).nullable(),
  /** The pinned dashboards it links to; one unpinned since is left out. */
  seeAlso: z.array(seeAlsoLinkSchema),
  /** The run of the period before, and of the period after, when there is one. */
  previous: neighbourSchema.nullable(),
  next: neighbourSchema.nullable(),
  /** How its message went, per channel; `null` until sent. */
  delivery: z.array(sendResultSchema).nullable(),
});

/** One run with its frozen results. */
export type ReportRunDetail = z.infer<typeof reportRunDetailSchema>;

/** Validates a preview: a spec run over its latest period, stored nowhere. */
export const reportPreviewSchema = z.object({
  period: periodViewSchema,
  comparison: periodViewSchema.nullable(),
  /** Each panel's run over the period; a panel that could not run is left out. */
  panels: z.record(z.string(), panelRunSchema),
  /** Each panel's run over the comparison period; `null` without one, or after a failure. */
  comparisonPanels: z.record(z.string(), panelRunSchema).nullable(),
  headlines: z.array(headlineSchema),
  /** Why a run would fail, in words that quote no secret; `null` when every query ran. */
  failure: z.string().nullable(),
  /** The run that would follow, in epoch milliseconds. */
  nextRunAt: z.number(),
});

/** A preview. */
export type ReportPreview = z.infer<typeof reportPreviewSchema>;
