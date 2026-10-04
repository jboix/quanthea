/**
 * The alert spec: a query, the number it watches, the condition that fires, how often it is
 * evaluated, and the message its notifications carry. Plain JSON, like the dashboard spec: the
 * server evaluates it with no model involved, and variables are fixed values bound at run time.
 */
import { z } from 'zod';
import { namedFormatterSchema } from '../formatters/schema.ts';
import { messageTemplateSchema } from '../notifications.ts';
import { variableNameSchema } from './names.ts';
import { durationSchema, panelQuerySchema } from './queries.ts';

/** How urgent an alert is. */
export const alertSeverities = ['critical', 'warning', 'info'] as const;

/** How urgent an alert is. */
export type AlertSeverity = (typeof alertSeverities)[number];

/** Milliseconds per duration unit. */
const unitMs: Readonly<Record<string, number>> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/**
 * The length of a duration such as `5m`.
 *
 * @param duration - A duration: digits and one of `s`, `m`, `h` or `d`.
 * @returns Its length in milliseconds, or `NaN` when it is not a duration.
 */
export function durationMs(duration: string): number {
  const match = /^(\d{1,5})([smhd])$/.exec(duration);
  if (!match) return Number.NaN;
  return Number(match[1]) * (unitMs[match[2] ?? ''] ?? Number.NaN);
}

/** The shortest evaluation interval: one minute. */
export const minEvaluationMs = 60_000;

/** The longest query window per evaluation: seven days. */
const maxLookbackMs = 7 * 86_400_000;

/** Validates how a number column of the result becomes one value per series. */
export const alertValueSchema = z.strictObject({
  /** The number field compared; the first number field when left out. */
  field: z.string().min(1).max(200).optional(),
  /** How the points of a series within the window become one value. */
  reduce: z.enum(['last', 'max', 'min', 'mean', 'sum']).default('last'),
  /**
   * The columns whose values tell series apart, for results in rows. Without them, a series is a
   * field's labels and every text column of its row.
   */
  by: z.array(z.string().min(1).max(200)).max(10).optional(),
  /** The most series one evaluation keeps; the rest are dropped, in order of their keys. */
  maxSeries: z.int().min(1).max(1000).default(100),
  /** How the value reads in a notification. */
  format: namedFormatterSchema.optional(),
});

/** Validates a variable's fixed value: no viewer picks it, the alert names it. */
export const alertVariableSchema = z.strictObject({
  name: variableNameSchema,
  value: z.union([z.string().max(200), z.array(z.string().max(200)).min(1).max(200)]),
  /** A duration that goes where a duration goes, such as `[$window]` in PromQL. */
  interval: z.boolean().optional(),
});

/** A variable of an alert, with its fixed value. */
export type AlertVariable = z.infer<typeof alertVariableSchema>;

/** Validates a threshold: the value of a series is above or below a number for a while. */
const thresholdConditionSchema = z.strictObject({
  kind: z.literal('threshold'),
  op: z.enum(['above', 'below']),
  value: z.number(),
  /** How long the condition holds before the series fires; `0m` fires at once. */
  for: durationSchema,
});

/** Validates a condition on the absence of data: the query returns no value for a while. */
const noDataConditionSchema = z.strictObject({
  kind: z.literal('no_data'),
  for: durationSchema,
});

/** Validates the condition that fires. */
export const alertConditionSchema = z.discriminatedUnion('kind', [
  thresholdConditionSchema,
  noDataConditionSchema,
]);

/** The condition that fires. */
export type AlertCondition = z.infer<typeof alertConditionSchema>;

/** Validates when notifications go out besides the first one of a firing. */
export const alertNotifySchema = z.strictObject({
  /** Whether a series that stops firing notifies. */
  onResolved: z.boolean().default(true),
  /** How often a series that keeps firing notifies again; once when left out. */
  repeatEvery: durationSchema.optional(),
});

/** The fields of an alert spec, before the checks across them. */
const alertSpecFields = z.strictObject({
  specVersion: z.literal(1),
  title: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  query: panelQuerySchema,
  value: alertValueSchema.prefault({}),
  variables: z.array(alertVariableSchema).max(20).default([]),
  condition: alertConditionSchema,
  /** How often the alert is evaluated; at least a minute. */
  every: durationSchema,
  /** The window each evaluation queries, ending at the evaluation; covers the condition's `for`. */
  lookback: durationSchema,
  severity: z.enum(alertSeverities),
  /** The notification channels, by id. */
  channels: z.array(z.string().min(1).max(64)).max(20).default([]),
  notify: alertNotifySchema.prefault({}),
  message: messageTemplateSchema,
  /** The IANA time zone notifications name times in; UTC when left out. */
  timezone: z.string().min(1).max(64).optional(),
});

/** An alert spec as its fields parse, before the checks across them. */
type AlertSpecFields = z.output<typeof alertSpecFields>;

/** One problem across the fields of a spec. */
interface FieldProblem {
  /** The path of the field. */
  readonly path: (string | number)[];
  /** What is wrong. */
  readonly message: string;
}

/**
 * The problems with the timing of an alert: its interval, window and repeat.
 *
 * @param spec - The parsed fields.
 * @returns The problems.
 */
function timingProblems(spec: AlertSpecFields): FieldProblem[] {
  const every = durationMs(spec.every);
  const lookback = durationMs(spec.lookback);
  const repeat = spec.notify.repeatEvery;
  const problems: FieldProblem[] = [];
  if (every < minEvaluationMs) problems.push({ path: ['every'], message: 'Use 1m or more.' });
  if (lookback < minEvaluationMs || lookback > maxLookbackMs)
    problems.push({ path: ['lookback'], message: 'Use a window from 1m to 7d.' });
  if (lookback < durationMs(spec.condition.for))
    problems.push({
      path: ['lookback'],
      message: 'Use a window at least as long as condition.for.',
    });
  if (repeat !== undefined && durationMs(repeat) < every)
    problems.push({ path: ['notify', 'repeatEvery'], message: 'Repeat no more often than every.' });
  return problems;
}

/**
 * The problems with the variables of an alert: names given twice, and intervals that are not
 * durations.
 *
 * @param spec - The parsed fields.
 * @returns The problems.
 */
function variableProblems(spec: AlertSpecFields): FieldProblem[] {
  const seen = new Set<string>();
  return spec.variables.flatMap((variable, index) => {
    const problems: FieldProblem[] = [];
    if (seen.has(variable.name))
      problems.push({ path: ['variables', index, 'name'], message: 'Name each variable once.' });
    seen.add(variable.name);
    const values = [variable.value].flat();
    if (variable.interval && values.some((value) => Number.isNaN(durationMs(value))))
      problems.push({ path: ['variables', index, 'value'], message: 'Use a duration such as 5m.' });
    return problems;
  });
}

/** Validates an alert spec, version 1. */
export const alertSpecSchema = alertSpecFields.superRefine((spec, context) => {
  for (const problem of [...timingProblems(spec), ...variableProblems(spec)])
    context.addIssue({ code: 'custom', path: problem.path, message: problem.message });
});

/** An alert spec, as parsed: defaults filled in. */
export type AlertSpec = z.output<typeof alertSpecSchema>;
