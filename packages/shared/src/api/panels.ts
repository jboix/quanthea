/**
 * Running saved panels. The browser names a panel of a stored version and picks variable values;
 * it never sends a query.
 */
import { z } from 'zod';
import { frameSchema } from '../frames.ts';
import { timeRangeSchema } from '../spec/time.ts';
import { variableValuesSchema } from '../spec/variables.ts';
import { defineEndpoint } from './contract.ts';

/** Validates what names a saved version and the viewer's choices. */
const runTargetSchema = z.object({
  dashboardId: z.string().min(1),
  version: z.int().min(1),
  variables: variableValuesSchema.default({}),
  /** The time range; the spec's default when omitted. */
  time: timeRangeSchema.optional(),
});

/** Validates why a query did not run: a code and a message that quotes no data. */
const queryFailureSchema = z.object({
  code: z.enum(['invalid', 'guardrail', 'timeout', 'connector']),
  message: z.string(),
});

/** Validates the outcome of one query. */
const queryOutcomeSchema = z.object({
  refId: z.string(),
  frames: z.array(frameSchema),
  error: queryFailureSchema.nullable(),
});

/** The outcome of one query of a panel: its frames, or why it failed. */
export type QueryOutcome = z.infer<typeof queryOutcomeSchema>;

/** Validates the markers of one annotation. */
const markerOutcomeSchema = z.object({
  annotation: z.string(),
  label: z.string(),
  points: z.array(z.object({ time: z.number(), text: z.string() })),
  error: queryFailureSchema.nullable(),
});

/** The markers of one annotation, such as deploys. */
export type MarkerOutcome = z.infer<typeof markerOutcomeSchema>;

/** Validates the result of a panel run. */
export const panelRunSchema = z.object({
  /** The time range the queries covered, in epoch milliseconds. */
  time: z.object({ from: z.number(), to: z.number() }),
  queries: z.array(queryOutcomeSchema),
  markers: z.array(markerOutcomeSchema),
  durationMs: z.number(),
});

/** The result of a panel run. */
export type PanelRun = z.infer<typeof panelRunSchema>;

/** Runs the queries of one saved panel, and the annotations it marks. */
export const runPanelEndpoint = defineEndpoint({
  method: 'POST',
  path: '/panels/run',
  body: runTargetSchema.extend({ panelId: z.string().min(1) }),
  output: panelRunSchema,
});

/** Lists the options of a query-backed variable. */
export const variableOptionsEndpoint = defineEndpoint({
  method: 'POST',
  path: '/variables/options',
  body: runTargetSchema.extend({ name: z.string().min(1) }),
  output: z.object({ options: z.array(z.string()) }),
});
