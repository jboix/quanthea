/**
 * The ratio of two queries: an alert may name a second query, and its value is then the first
 * query's value divided by the second's, series matched by their labels. The ratio is the alert's
 * value, so the condition compares it as it compares any value. Plain JSON, no formula.
 */
import { z } from 'zod';
import {
  type AlertCondition,
  type ConditionProblem,
  type ConditionTest,
  conditionTests,
  readsHistory,
  testPath,
} from './alert-condition.ts';
import { panelQuerySchema } from './queries.ts';

/** What a ratio reads when the second query's value is 0: the number 0, or no value. */
export const ratioZeroRules = ['zero', 'no_value'] as const;

/** What a ratio reads when the second query's value is 0. */
export type RatioZeroRule = (typeof ratioZeroRules)[number];

/** Validates the second query of a ratio and how its result is read. */
export const alertDivisorSchema = z.strictObject({
  /** The second query, on the same connector or another. The alert's variables bind in it too. */
  query: panelQuerySchema,
  /** The number field it divides by; the first number field when left out. */
  field: z.string().min(1).max(200).optional(),
  /** The columns whose values tell its series apart, for results in rows, as `value.by` does. */
  by: z.array(z.string().min(1).max(200)).max(10).optional(),
  /**
   * What the ratio reads when the second query's value is 0: `zero`, the number 0, or `no_value`,
   * which never holds.
   */
  whenZero: z.enum(ratioZeroRules).default('zero'),
});

/** The second query of a ratio, as parsed. */
export type AlertDivisor = z.output<typeof alertDivisorSchema>;

/**
 * Whether a test reads the ratio: it reads the alert's value, so it names no field of its own.
 *
 * @param test - The test.
 * @returns `true` for a test without a `field`.
 */
export function readsRatio(test: ConditionTest): boolean {
  return !('field' in test) || test.field === undefined;
}

/**
 * The problems of a condition on a ratio: a ratio is a value of two queries, so a condition about
 * one query's absence does not fit, nor does a test that would read the history of both.
 *
 * @param condition - The condition.
 * @param divided - Whether the alert names a second query.
 * @returns The problems, with paths from the spec.
 */
export function ratioProblems(condition: AlertCondition, divided: boolean): ConditionProblem[] {
  if (!divided) return [];
  if (condition.kind === 'no_data')
    return [
      {
        path: ['dividedBy'],
        message: 'A no_data condition watches one query: leave dividedBy out.',
      },
    ];
  return conditionTests(condition).flatMap((test, index) =>
    readsHistory(test) && readsRatio(test)
      ? [
          {
            path: testPath(condition, index, 'kind'),
            message:
              'A ratio is compared by a threshold or a change. A past or a band would read the history of both queries: put the division in the query instead.',
          },
        ]
      : [],
  );
}

/**
 * The connectors the queries of an alert run on.
 *
 * @param spec - The spec.
 * @param spec.query - Its query.
 * @param spec.dividedBy - The second query of a ratio, if any.
 * @returns The alert's connector, then the second query's when a ratio names another.
 */
export function alertConnectors(spec: {
  readonly query: { readonly connector: string };
  readonly dividedBy?: { readonly query: { readonly connector: string } } | undefined;
}): string[] {
  const second = spec.dividedBy ? [spec.dividedBy.query.connector] : [];
  return [...new Set([spec.query.connector, ...second])];
}
