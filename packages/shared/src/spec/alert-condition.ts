/**
 * The condition of an alert: a closed set of named kinds, plain JSON. A test compares the value of
 * a series (`threshold`), its latest point with an earlier one (`change`), its value with its
 * value a period before (`past`), or its value with the band its recent history gives (`band`).
 * `all` and `any` join two to four tests, each on its own number field, and `no_data` is about the
 * query as a whole. Every kind has a `for`: how long it holds before the series fires.
 */
import { z } from 'zod';
import { namedFormatterInputSchema, namedFormatterSchema } from '../formatters/schema.ts';
import { durationSchema } from './queries.ts';

/** How the points of a series within the window become one value. */
export const alertReducers = ['last', 'max', 'min', 'mean', 'sum'] as const;

/** How the points of a series within the window become one value. */
export type AlertReducer = (typeof alertReducers)[number];

/** The fields of a threshold: the value is strictly above or below a number. */
const thresholdFields = {
  kind: z.literal('threshold'),
  op: z.enum(['above', 'below']),
  value: z.number(),
};

/**
 * The fields of a change: the latest point of the window against the latest point at least
 * `within` before it.
 */
const changeFields = {
  kind: z.literal('change'),
  /** Whether it fires on a rise or on a drop. */
  direction: z.enum(['up', 'down']),
  /** How much, at least: a share of the earlier value in percent, or a difference. */
  amount: z.number().positive(),
  unit: z.enum(['percent', 'absolute']),
  /** How far back the earlier point is, inside the lookback. */
  within: durationSchema,
};

/** How far back a `past` test compares a series with itself: an hour, a day or a week. */
export const pastPeriods = ['1h', '1d', '7d'] as const;

/** How far back a `past` test compares a series with itself. */
export type PastPeriod = (typeof pastPeriods)[number];

/**
 * The fields of a comparison with the past: the value of the window against the value of the same
 * window `ago` before.
 */
const pastFields = {
  kind: z.literal('past'),
  /** Whether it fires above or below the value then. */
  direction: z.enum(['up', 'down']),
  /** How much, at least: a share of the value then in percent, or a difference. */
  amount: z.number().positive(),
  unit: z.enum(['percent', 'absolute']),
  /** How far back the window it compares with is. */
  ago: z.enum(pastPeriods),
};

/** The fewest and the most deviations a band is wide, each side of the mean. */
export const bandDeviations = { min: 0.5, max: 10 } as const;

/** The shortest and the longest baseline a band is learned from: an hour and seven days. */
export const bandBaselineMs = { min: 3_600_000, max: 7 * 86_400_000 } as const;

/**
 * The fields of a band: the value of the window against the mean of the series over the baseline
 * before the window, give or take a number of standard deviations.
 */
const bandFields = {
  kind: z.literal('band'),
  /** Which side of the band fires: over it, under it, or either. */
  side: z.enum(['above', 'below', 'either']),
  /** How many standard deviations the band reaches each side of the mean. */
  deviations: z.number().min(bandDeviations.min).max(bandDeviations.max),
  /** How long the history before the window is that the band is learned from. */
  baseline: durationSchema,
};

/**
 * What a test of a joined condition may read besides the alert's value. It may also name a
 * `format`: how its threshold and values read, the alert's `value.format` when left out.
 */
const partFields = {
  /** The number field it reads; the alert's `value.field` when left out. */
  field: z.string().min(1).max(200).optional(),
};

/** Validates a threshold: the value of a series is above or below a number for a while. */
const thresholdConditionSchema = z.strictObject({
  ...thresholdFields,
  /** How long the condition holds before the series fires; `0m` fires at once. */
  for: durationSchema,
});

/** Validates a change: the value rose or dropped by an amount within a duration. */
const changeConditionSchema = z.strictObject({ ...changeFields, for: durationSchema });

/** Validates a comparison with the past: the value against the same window a period before. */
const pastConditionSchema = z.strictObject({ ...pastFields, for: durationSchema });

/** Validates a band: the value against the mean and deviation of its recent history. */
const bandConditionSchema = z.strictObject({ ...bandFields, for: durationSchema });

/** Validates a condition on the absence of data: the query returns no value for a while. */
const noDataConditionSchema = z.strictObject({
  kind: z.literal('no_data'),
  for: durationSchema,
});

/**
 * Validates one test of a joined condition.
 *
 * @param format - How a part's `format` is validated.
 * @returns The schema.
 */
const conditionPartSchemaWith = <Format extends z.ZodType>(format: Format) => {
  const part = { ...partFields, format: format.optional() };
  // A part that reduces its points may name how; the alert's `value.reduce` when left out.
  const reduced = { ...part, reduce: z.enum(alertReducers).optional() };
  return z.discriminatedUnion('kind', [
    z.strictObject({ ...thresholdFields, ...reduced }),
    z.strictObject({ ...changeFields, ...part }),
    z.strictObject({ ...pastFields, ...reduced }),
    z.strictObject({ ...bandFields, ...reduced }),
  ]);
};

/** Validates one test of a joined condition. */
const conditionPartSchema = conditionPartSchemaWith(namedFormatterSchema);

/** One test of a joined condition. */
export type ConditionPart = z.infer<typeof conditionPartSchema>;

/**
 * Validates tests joined: every one holds (`all`), or at least one (`any`).
 *
 * @param kind - How they are joined.
 * @returns The schema.
 */
const joinedConditionSchema = <Kind extends 'all' | 'any'>(kind: Kind) =>
  z.strictObject({
    kind: z.literal(kind),
    /** The tests, never joined ones. The first reads the alert's value. */
    of: z.array(conditionPartSchema).min(2).max(4),
    for: durationSchema,
  });

/** Validates the condition that fires. */
export const alertConditionSchema = z.discriminatedUnion('kind', [
  thresholdConditionSchema,
  changeConditionSchema,
  pastConditionSchema,
  bandConditionSchema,
  joinedConditionSchema('all'),
  joinedConditionSchema('any'),
  noDataConditionSchema,
]);

/** The condition that fires. */
export type AlertCondition = z.infer<typeof alertConditionSchema>;

/**
 * Validates the condition as a tool's input writes it: the same kinds and fields, in a smaller
 * JSON schema. `all` and `any` share one shape, and a part's `format` is the one shape of every
 * named formatter. It is wider than {@link alertConditionSchema}, which the spec's check applies.
 */
export const alertConditionInputSchema = z.discriminatedUnion('kind', [
  thresholdConditionSchema,
  changeConditionSchema,
  pastConditionSchema,
  bandConditionSchema,
  z.strictObject({
    kind: z.enum(['all', 'any']),
    of: z.array(conditionPartSchemaWith(namedFormatterInputSchema)).min(2).max(4),
    for: durationSchema,
  }),
  noDataConditionSchema,
]);

/** A condition that joins tests. */
export type JoinedCondition = Extract<AlertCondition, { kind: 'all' | 'any' }>;

/**
 * A test: a threshold, a change, a comparison with the past or a band, alone as a condition or as
 * a part of a joined one.
 */
export type ConditionTest =
  | ConditionPart
  | Extract<AlertCondition, { kind: 'threshold' | 'change' | 'past' | 'band' }>;

/** A test that reads the time before the window, with a query of its own. */
export type HistoryTest = Extract<ConditionTest, { kind: 'past' | 'band' }>;

/**
 * Whether a test reads the time before the window.
 *
 * @param test - The test.
 * @returns `true` for a comparison with the past and for a band.
 */
export function readsHistory(test: ConditionTest): test is HistoryTest {
  return test.kind === 'past' || test.kind === 'band';
}

/**
 * The tests of a condition, in order.
 *
 * @param condition - The condition.
 * @returns Its parts when it joins some, itself when it is one test, none for `no_data`.
 */
export function conditionTests(condition: AlertCondition): readonly ConditionTest[] {
  if (condition.kind === 'no_data') return [];
  if (condition.kind === 'all' || condition.kind === 'any') return condition.of;
  return [condition];
}

/** One problem of a condition against the rest of the spec. */
export interface ConditionProblem {
  /** The path of the field, from the spec. */
  readonly path: (string | number)[];
  /** What is wrong. */
  readonly message: string;
}

/**
 * The problems of a joined condition's first part: it reads the alert's value, so it names no
 * field, reducer or format of its own.
 *
 * @param condition - The condition.
 * @returns The problems.
 */
function firstPartProblems(condition: AlertCondition): ConditionProblem[] {
  if (condition.kind !== 'all' && condition.kind !== 'any') return [];
  const first: Record<string, unknown> = condition.of[0] ?? {};
  return ['field', 'reduce', 'format']
    .filter((name) => first[name] !== undefined)
    .map((name) => ({
      path: ['condition', 'of', 0, name],
      message: `The first part reads the alert's value: set value.${name} instead.`,
    }));
}

/**
 * The path of a field of one test, from the spec.
 *
 * @param condition - The condition.
 * @param index - The test, in the order of {@link conditionTests}.
 * @param name - The field.
 * @returns Such as `condition.within`, or `condition.of[1].within` in a joined condition.
 */
export function testPath(
  condition: AlertCondition,
  index: number,
  name: string,
): (string | number)[] {
  const joined = condition.kind === 'all' || condition.kind === 'any';
  return joined ? ['condition', 'of', index, name] : ['condition', name];
}

/**
 * The problems of the tests that read history: a baseline out of bounds, and more than one such
 * test, since each costs a query at every evaluation.
 *
 * @param condition - The condition.
 * @param durationMs - Reads a duration in milliseconds.
 * @returns The problems.
 */
function historyProblems(
  condition: AlertCondition,
  durationMs: (duration: string) => number,
): ConditionProblem[] {
  const tests = conditionTests(condition);
  const reading = tests.flatMap((test, index) => (readsHistory(test) ? [index] : []));
  const extra = reading.slice(1).map((index) => ({
    path: ['condition', 'of', index] as (string | number)[],
    message: 'Only one test of a condition compares with history: it costs a query of its own.',
  }));
  const bounds = tests.flatMap((test, index) => {
    if (test.kind !== 'band') return [];
    const length = durationMs(test.baseline);
    if (length >= bandBaselineMs.min && length <= bandBaselineMs.max) return [];
    return [
      { path: testPath(condition, index, 'baseline'), message: 'Use a baseline from 1h to 7d.' },
    ];
  });
  return [...bounds, ...extra];
}

/** The reducers a band can judge: its limits are learned from the single points of the baseline. */
const bandReducers: readonly AlertReducer[] = ['last', 'mean'];

/** Why a band refuses a reducer. */
const bandReducerMessage =
  'A band is learned from the single points of the baseline: use last or mean, never a sum, a maximum or a minimum of the window.';

/**
 * The problems of the bands whose value is not on the scale of the baseline's points: a sum, a
 * maximum or a minimum of the window is never comparable with the mean of single points.
 *
 * @param condition - The condition.
 * @param reduce - The alert's `value.reduce`.
 * @returns The problems, at the reducer the band reads its value with: its own, else the alert's.
 */
function bandReducerProblems(condition: AlertCondition, reduce: AlertReducer): ConditionProblem[] {
  return conditionTests(condition).flatMap((test, index) => {
    if (test.kind !== 'band') return [];
    const own = (test as { readonly reduce?: AlertReducer }).reduce;
    if (bandReducers.includes(own ?? reduce)) return [];
    const path = own === undefined ? ['value', 'reduce'] : testPath(condition, index, 'reduce');
    return [{ path, message: bandReducerMessage }];
  });
}

/**
 * The problems of the changes whose span has no length: the latest point would be its own earlier
 * point, and the change always 0.
 *
 * @param condition - The condition.
 * @param durationMs - Reads a duration in milliseconds.
 * @returns The problems, at each such `within`.
 */
function withinProblems(
  condition: AlertCondition,
  durationMs: (duration: string) => number,
): ConditionProblem[] {
  return conditionTests(condition).flatMap((test, index) => {
    if (test.kind !== 'change' || durationMs(test.within) > 0) return [];
    return [{ path: testPath(condition, index, 'within'), message: 'Use a span above zero.' }];
  });
}

/**
 * The problems of a condition against the value it reads and the window it is given.
 *
 * @param condition - The condition.
 * @param reduce - The alert's `value.reduce`.
 * @param lookbackMs - The alert's `lookback`, in milliseconds.
 * @param durationMs - Reads a duration in milliseconds.
 * @returns The problems, with paths from the spec.
 */
export function conditionProblems(
  condition: AlertCondition,
  reduce: AlertReducer,
  lookbackMs: number,
  durationMs: (duration: string) => number,
): ConditionProblem[] {
  const tests = conditionTests(condition);
  const problems = [
    ...firstPartProblems(condition),
    ...historyProblems(condition, durationMs),
    ...bandReducerProblems(condition, reduce),
    ...withinProblems(condition, durationMs),
  ];
  if (tests[0]?.kind === 'change' && reduce !== 'last')
    problems.push({
      path: ['value', 'reduce'],
      message: 'A change compares the latest point with an earlier one: use last.',
    });
  if (tests.some((test) => test.kind === 'change' && durationMs(test.within) >= lookbackMs))
    problems.push({
      path: ['lookback'],
      message: "Use a window longer than the change's within, so it holds the earlier point.",
    });
  return problems;
}
