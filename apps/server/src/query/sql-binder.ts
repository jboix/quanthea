/**
 * Binds variables into a SQL template: `:name` placeholders become positional parameters, so a
 * value never becomes SQL text. Also checks the template is a single read statement.
 */
import type { SqlDialect, SqlParameter, SqlQuery, TimeRange } from '../connectors/_shared/index.ts';
import { QueryError } from './query-error.ts';
import { type SqlDialectRules, sqlDialectRules } from './sql-dialects.ts';
import { type SqlSegment, splitSql } from './sql-lexer.ts';
import { type Variables, valuesOf } from './variables.ts';

/** A `:name` placeholder that is not part of a `::type` cast. */
const namedPlaceholder = /(?<!:):([A-Za-z_][A-Za-z0-9_]*)/g;

/** The first keyword of a read statement. */
const readStatementStart = /^[\s(]*(select|with|values|table)\b/i;

/** Keywords that write or change the schema, which a read statement never contains. */
const writeKeywords =
  /\b(insert|update|delete|merge|truncate|drop|alter|create|grant|revoke|copy|into)\b/i;

/**
 * Checks the code of a template is one read statement, without a keyword its dialect refuses. The
 * read-only session is the real guard; this check rejects the obvious cases with a clear message
 * before they reach the source.
 *
 * @param segments - The template, split into code and literals.
 * @param rules - The dialect's rules.
 * @throws {QueryError} `invalid` when the template is not a single SELECT, WITH, VALUES or TABLE.
 */
function checkReadStatement(segments: readonly SqlSegment[], rules: SqlDialectRules): void {
  const code = segments.map((segment) => (segment.kind === 'code' ? segment.text : ' ')).join('');
  const statement = code.replace(/;\s*$/, '');
  if (statement.includes(';')) throw new QueryError('invalid', 'A query holds one statement only.');
  if (!readStatementStart.test(statement)) {
    throw new QueryError('invalid', 'A query starts with SELECT, WITH, VALUES or TABLE.');
  }
  const write = writeKeywords.exec(statement);
  if (write) {
    throw new QueryError(
      'invalid',
      `A query only reads; "${write[1]?.toUpperCase()}" is not allowed. Quote an identifier with that name.`,
    );
  }
  if (rules.forbidden?.keyword.test(statement))
    throw new QueryError('invalid', rules.forbidden.message);
}

/** Collects parameters as placeholders are bound. */
interface ParameterList {
  /** The dialect's rules. */
  readonly rules: SqlDialectRules;
  /** The values, in placeholder order. */
  readonly values: SqlParameter[];
  /** The placeholder text already bound for each variable, so repeats reuse it. */
  readonly byName: Map<string, string>;
  /** Variables the template uses that have no value. */
  readonly unknown: Set<string>;
}

/**
 * The placeholder text for one variable: a placeholder, a list of them for several values, or
 * `NULL` for none. A numbered placeholder is reused when the variable comes again.
 *
 * @param name - The variable name.
 * @param values - The values to bind.
 * @param parameters - The parameters bound so far.
 * @returns The text that replaces `:name`.
 */
function placeholderFor(
  name: string,
  values: readonly SqlParameter[],
  parameters: ParameterList,
): string {
  const { rules } = parameters;
  const known = parameters.byName.get(name);
  if (known !== undefined && rules.numbered) return known;
  const placeholders = values.map((value) => {
    parameters.values.push(value);
    return rules.placeholder(parameters.values.length, value);
  });
  const text = placeholders.length === 0 ? 'NULL' : placeholders.join(', ');
  parameters.byName.set(name, text);
  return text;
}

/**
 * The values of a variable or built-in.
 *
 * @param name - The variable name.
 * @param variables - The variables.
 * @param timeRange - The time range, for `:__from` and `:__to`.
 * @returns The values, or `undefined` for an unknown variable.
 */
function sqlValues(
  name: string,
  variables: Variables,
  timeRange: TimeRange,
): readonly SqlParameter[] | undefined {
  if (name === '__from') return [timeRange.from];
  if (name === '__to') return [timeRange.to];
  const binding = variables[name];
  return binding ? valuesOf(binding) : undefined;
}

/**
 * Binds the variables of one run of code.
 *
 * @param code - The code.
 * @param variables - The variable values.
 * @param timeRange - The time range.
 * @param parameters - The parameters bound so far.
 * @returns The code with placeholders.
 * @throws {QueryError} `invalid` for a placeholder the template wrote itself.
 */
function bindCode(
  code: string,
  variables: Variables,
  timeRange: TimeRange,
  parameters: ParameterList,
): string {
  const { rules } = parameters;
  if (rules.writtenPlaceholder.test(code))
    throw new QueryError('invalid', rules.writtenPlaceholderMessage);
  return code.replace(namedPlaceholder, (placeholder, name: string) => {
    const values = sqlValues(name, variables, timeRange);
    if (values === undefined) parameters.unknown.add(name);
    return values === undefined ? placeholder : placeholderFor(name, values, parameters);
  });
}

/**
 * Binds a SQL template.
 *
 * @param template - The SQL with `:name` variables; `:__from` and `:__to` are the time range.
 * @param variables - The variable values.
 * @param timeRange - The time range.
 * @param dialect - The connector's dialect, which sets the literals and the placeholders.
 * @returns The bound query: the dialect's placeholders and their values.
 * @throws {QueryError} `invalid` for an unknown variable, a placeholder written in the template, an
 *   unclosed literal, or a template that is not one read statement.
 */
export function bindSql(
  template: string,
  variables: Variables,
  timeRange: TimeRange,
  dialect: SqlDialect,
): SqlQuery {
  const rules = sqlDialectRules[dialect];
  const segments = splitSql(template, rules.lexicon);
  checkReadStatement(segments, rules);
  const parameters: ParameterList = { rules, values: [], byName: new Map(), unknown: new Set() };
  const text = segments
    .map((segment) =>
      segment.kind === 'literal'
        ? segment.text
        : bindCode(segment.text, variables, timeRange, parameters),
    )
    .join('');
  if (parameters.unknown.size > 0) {
    const names = [...parameters.unknown].map((name) => `:${name}`).join(', ');
    throw new QueryError('invalid', `Unknown variables: ${names}.`);
  }
  return { language: 'sql', text, parameters: parameters.values };
}
