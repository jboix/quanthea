/**
 * Binds variables into a LogQL template. A `$name` is replaced only inside the string value of a
 * stream matcher (`{app="$app"}`), a line filter (`|= "$text"`) or a label filter
 * (`| level="$level"`), escaped for that string and, after `=~`, `!~` or `|~`, as a regular
 * expression too. Formatting templates are refused: Loki runs them.
 */
import type { LogqlQuery } from '../connectors/_shared/index.ts';
import {
  type BindingState,
  bindExpression,
  type ExpressionFlavor,
  type PromqlTemplate,
} from './promql-binder.ts';
import type { ExpressionRun } from './promql-step.ts';
import { QueryError } from './query-error.ts';
import type { Variables } from './variables.ts';

/** The operator a value string follows: a matcher, a line filter or a label filter. */
const valueOperator = /(\|=|\|~|=~|!~|!=|=)\s*$/;

/** Stages whose argument is a template Loki runs, which a query may not use. */
const templateStage = /\b(line_format|label_format)\b/;

/** LogQL: variables go in matcher, line filter and label filter values. */
const logqlFlavor: ExpressionFlavor = {
  operatorOf: (state: BindingState) => valueOperator.exec(state.previousCode)?.[1],
  misplaced:
    'Variables go in quoted values: {app="$app"}, |= "$text", | level="$level". Only an interval variable goes where a duration does, such as [$interval].',
  checkCode: (code) => {
    const stage = templateStage.exec(code);
    if (stage) {
      throw new QueryError(
        'invalid',
        `A query runs no template; "${stage[1]}" is not allowed. Select labels with | json or | logfmt instead.`,
      );
    }
  },
};

/**
 * Binds a LogQL template.
 *
 * @param template - The expression, and whether it is instant and its step.
 * @param variables - The variable values.
 * @param run - The time range, the point limit, the chosen interval and the chart's points.
 * @returns The bound query.
 * @throws {QueryError} `invalid` for an unknown variable, a variable outside a quoted value, a
 *   formatting template, or an unclosed string.
 */
export function bindLogql(
  template: PromqlTemplate,
  variables: Variables,
  run: ExpressionRun,
): LogqlQuery {
  return { language: 'logql', ...bindExpression(template, variables, run, logqlFlavor) };
}
