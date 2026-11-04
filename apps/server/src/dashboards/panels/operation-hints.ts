/**
 * Hints for the mistakes a model makes most often in a panel's operations and further requests,
 * added after Zod's issues so that one more try fixes them.
 */
import type { z } from 'zod';

/** How a step names a further request, and the refIds those requests take. */
const refIdHint =
  '"with" names a request in "more" by its refId, a string: "B" for the first, then "C" and "D".';

/** What a join's `how` takes. */
const howHint =
  '"how" is "outer" (every key of either side, the default) or "inner" (the keys both have).';

/** What a pivot sums. */
const pivotHint = 'A pivot sums one number column, named by "value", not "values".';

/** Why a further request has no id. */
const moreIdHint =
  'A request in "more" has no "id": its refId comes from its place, "B" for the first, then "C" and "D".';

/**
 * The hint for one issue of the operations, if it is a common mistake.
 *
 * @param issue - The issue.
 * @returns The hint, or `undefined`.
 */
function operationHint(issue: z.core.$ZodIssue): string | undefined {
  const last = issue.path.at(-1);
  if (last === 'with') return refIdHint;
  if (last === 'how') return howHint;
  if (last === 'value') return pivotHint;
  if (issue.code === 'unrecognized_keys' && issue.keys.includes('values')) return pivotHint;
  return undefined;
}

/**
 * The hints for the issues of a panel's operations, each once.
 *
 * @param issues - The issues.
 * @returns The hints, joined by spaces; empty when none applies.
 */
export function operationHints(issues: readonly z.core.$ZodIssue[]): string {
  const hints = new Set(issues.flatMap((issue) => operationHint(issue) ?? []));
  return [...hints].join(' ');
}

/**
 * The hint for the issues of a further request, when it names an id.
 *
 * @param issues - The issues.
 * @returns The hint, or an empty string.
 */
export function moreHints(issues: readonly z.core.$ZodIssue[]): string {
  const namesId = issues.some(
    (issue) => issue.code === 'unrecognized_keys' && issue.keys.includes('id'),
  );
  return namesId ? moreIdHint : '';
}
