/**
 * Report endpoints: list and read reports and their runs, activate or deactivate a version, run
 * one now, preview a spec and send a test. Runs are computed on schedule with no model and frozen;
 * reading one runs no query. Versions are never rewritten, and one version at a time is active.
 */
import { z } from 'zod';
import { reportPeriodSchema } from '../reports/period.ts';
import { reportScheduleSchema } from '../reports/schedule.ts';
import { durationMs } from '../spec/alert.ts';
import { durationSchema } from '../spec/queries.ts';
import { reportSpecSchema } from '../spec/report.ts';
import { defineEndpoint } from './contract.ts';
import { sendResultSchema } from './notification-channels.ts';
import {
  reportPreviewSchema,
  reportRunDetailSchema,
  reportRunSummarySchema,
} from './report-runs.ts';

/** Validates a report without its versions, for lists. */
export const reportSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  activeVersion: z.int().nullable(),
  /** The latest version, maybe a draft; `null` below editor. */
  latestVersion: z.int().nullable(),
  /** Whether its schedule is stopped. */
  deactivated: z.boolean(),
  /** The schedule of the active version, else of the latest. */
  schedule: reportScheduleSchema,
  /** The period of the same version. */
  period: reportPeriodSchema,
  /** When it runs next; `null` while it is not active. */
  nextRunAt: z.number().nullable(),
  /** Its latest run, with its headline numbers; `null` before the first. */
  lastRun: reportRunSummarySchema.nullable(),
  /** The conversation that made it, if any. */
  threadId: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

/** A report without its versions. */
export type ReportSummary = z.infer<typeof reportSummarySchema>;

/** Validates a version of a report. */
const reportVersionSchema = z.object({
  version: z.int(),
  spec: reportSpecSchema,
  note: z.string().nullable(),
  /** The name of whoever saved it. */
  createdBy: z.string(),
  createdAt: z.number(),
  /** When it was first activated. */
  activatedAt: z.number().nullable(),
});

/** Validates a report with its versions: every one for editors, those ever active for others. */
export const reportDetailSchema = reportSummarySchema.extend({
  versions: z.array(reportVersionSchema),
});

/** A report with its versions. */
export type ReportDetail = z.infer<typeof reportDetailSchema>;

/** The path parameter of one report. */
const reportParams = z.object({ reportId: z.string().min(1).max(64) });

/** Lists the reports, with their latest run. Below editor, a report shows once it is active. */
export const listReportsEndpoint = defineEndpoint({
  method: 'GET',
  path: '/reports',
  output: z.object({ reports: z.array(reportSummarySchema) }),
});

/** Reads a report with its versions. */
export const getReportEndpoint = defineEndpoint({
  method: 'GET',
  path: '/reports/:reportId',
  params: reportParams,
  output: reportDetailSchema,
});

/** Lists a report's runs, the latest period first. */
export const listReportRunsEndpoint = defineEndpoint({
  method: 'GET',
  path: '/reports/:reportId/runs',
  params: reportParams,
  query: z.object({
    /** Only runs whose period starts before this instant, to page back. */
    before: z.coerce.number().int().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  }),
  output: z.object({ runs: z.array(reportRunSummarySchema) }),
});

/** Reads one run with its frozen results, and the runs of the periods either side. */
export const getReportRunEndpoint = defineEndpoint({
  method: 'GET',
  path: '/reports/:reportId/runs/:runId',
  params: reportParams.extend({ runId: z.string().min(1).max(64) }),
  output: reportRunDetailSchema,
});

/** Activates a version: it is checked and its queries run once over its latest period. */
export const activateReportEndpoint = defineEndpoint({
  method: 'POST',
  path: '/reports/:reportId/activate',
  params: reportParams,
  body: z.object({ version: z.int().min(1) }),
  output: reportSummarySchema,
});

/** Stops a report's schedule, keeping its active version and its runs. */
export const deactivateReportEndpoint = defineEndpoint({
  method: 'POST',
  path: '/reports/:reportId/deactivate',
  params: reportParams,
  output: reportSummarySchema,
});

/** Runs the active version (else the latest) now, over its latest period; sends when asked. */
export const runReportNowEndpoint = defineEndpoint({
  method: 'POST',
  path: '/reports/:reportId/run',
  params: reportParams,
  body: z.object({ send: z.boolean().default(false) }),
  output: reportRunSummarySchema,
});

/** Runs a spec, such as a draft, over its latest period. Nothing is stored or sent. */
export const previewReportEndpoint = defineEndpoint({
  method: 'POST',
  path: '/reports/preview',
  body: z.object({ spec: z.unknown() }),
  output: reportPreviewSchema,
});

/** Sends a version's message, built from a preview, to its channels as a test. */
export const testReportEndpoint = defineEndpoint({
  method: 'POST',
  path: '/reports/:reportId/versions/:version/test',
  params: reportParams.extend({ version: z.string().regex(/^[1-9]\d{0,5}$/) }),
  output: z.object({ results: z.array(sendResultSchema) }),
});

/** The shortest and longest wait before a failed run tries again. */
const retryDelayBounds = { min: 60_000, max: 86_400_000 } as const;

/**
 * Validates the report settings: how many times a failed run tries again and after how long, and
 * how many days runs are kept.
 */
export const reportSettingsSchema = z.strictObject({
  /** How many times a failed run tries again before it is marked failed. */
  maxRetries: z.int().min(0).max(10).default(2),
  /** How long it waits before each new try; 1m to 1d. */
  retryDelay: durationSchema
    .refine((delay) => {
      const ms = durationMs(delay);
      return ms >= retryDelayBounds.min && ms <= retryDelayBounds.max;
    }, 'Use a delay from 1m to 1d.')
    .default('15m'),
  /** How many days runs are kept; `null` keeps them for good. */
  keepRunsDays: z.int().min(1).max(3650).nullable().default(null),
});

/** The report settings. */
export type ReportSettings = z.infer<typeof reportSettingsSchema>;

/** The report settings, for admins. */
export const getReportSettingsEndpoint = defineEndpoint({
  method: 'GET',
  path: '/settings/reports',
  output: reportSettingsSchema,
});

/** Saves the report settings. */
export const saveReportSettingsEndpoint = defineEndpoint({
  method: 'PUT',
  path: '/settings/reports',
  body: reportSettingsSchema,
  output: reportSettingsSchema,
});
