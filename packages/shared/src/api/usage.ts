/**
 * The usage report: what the model steps spent and how often pinned dashboards were viewed, by
 * hour and user, from the ledger that outlives threads. The browser adds the hours up into its own days.
 */
import { z } from 'zod';
import { roleSchema } from '../roles.ts';
import { defineEndpoint } from './contract.ts';

/** Validates one hour of one kind of event for one model. */
export const usageBucketSchema = z.object({
  /** The start of the hour, epoch milliseconds. */
  hour: z.number(),
  /** A model step, or a view of a pinned dashboard. */
  kind: z.enum(['model', 'pinned_view']),
  /** The provider; empty for pinned views. */
  provider: z.string(),
  /** The model id; empty for pinned views. */
  model: z.string(),
  /** Who the model steps ran for: their thread's owner; empty outside a thread and for views. */
  userId: z.string(),
  /** Fresh input tokens. */
  input: z.number(),
  /** Input tokens read from the cache. */
  cachedInput: z.number(),
  /** Input tokens written to the cache. */
  cacheWrite: z.number(),
  /** Output tokens. */
  output: z.number(),
  /** The list price at the time, in US dollars, for the steps that had one. */
  dollars: z.number(),
  /** How many events. */
  events: z.number(),
  /** How many model steps had no price. */
  unpriced: z.number(),
});

/** One hour of the report. */
export type UsageBucket = z.infer<typeof usageBucketSchema>;

/** Validates the report. */
export const usageReportSchema = z.object({
  /** The start of the range, epoch milliseconds. */
  from: z.number(),
  /** The end of the range. */
  to: z.number(),
  /** When the prices behind the costs were checked. */
  pricesCheckedOn: z.string(),
  /** The hours with events, oldest first. */
  buckets: z.array(usageBucketSchema),
  /** The name and role of each user the buckets name; the role is `null` for one who is gone. */
  people: z.record(z.string(), z.object({ name: z.string(), role: roleSchema.nullable() })),
});

/** The usage report. */
export type UsageReport = z.infer<typeof usageReportSchema>;

/** The usage of the last days. */
export const usageReportEndpoint = defineEndpoint({
  method: 'GET',
  path: '/settings/usage',
  query: z.object({ days: z.coerce.number().int().min(1).max(366).default(30) }),
  output: usageReportSchema,
});
