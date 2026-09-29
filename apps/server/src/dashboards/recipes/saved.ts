/**
 * Saved recipes: an admin's query with typed placeholders. Each placeholder is checked for its
 * kind and written for the query's language, like the built-in recipes write theirs: names
 * checked and quoted, values escaped or bound, durations checked.
 */
import type { PanelQuery, RecipeParamKind, SavedRecipe } from '@querent/shared';
import type { PanelDraft } from './draft.ts';
import type { RecipeOf } from './request.ts';
import { metricName, RecipeError, sqlInterval, sqlName, sqlString, variableOf } from './text.ts';
import { viewOfKind } from './views.ts';

/** A plain label or column name. */
const plainName = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** A table, or a schema and a table. */
const tableName = /^[A-Za-z_]\w*(\.[A-Za-z_]\w*)?$/;

/** A duration, or an interval variable. */
const duration = /^(\d{1,5}[smhd]|\$[A-Za-z_]\w*)$/;

/**
 * Checks a value against a pattern.
 *
 * @param value - The value.
 * @param pattern - The pattern.
 * @param what - What the value should be, for the error.
 * @returns The value.
 * @throws {RecipeError} When it does not match.
 */
function checked(value: string, pattern: RegExp, what: string): string {
  if (!pattern.test(value)) throw new RecipeError(`"${value}" is not ${what}.`);
  return value;
}

/**
 * A value in a query: a bound variable, or an escaped literal.
 *
 * @param value - Such as `checkout-svc` or `$service`.
 * @param language - The query language.
 * @returns Such as `"checkout-svc"` in PromQL or `:service` in SQL.
 */
function valueText(value: string, language: SavedRecipe['language']): string {
  const variable = variableOf(value);
  if (language === 'promql') return variable ? `"${value}"` : JSON.stringify(value);
  return variable ? `:${variable}` : sqlString(value);
}

/** How each kind of placeholder is written, in SQL or in PromQL. */
const writers: Readonly<Record<RecipeParamKind, (value: string, sql: boolean) => string>> = {
  value: (value, sql) => valueText(value, sql ? 'sql' : 'promql'),
  duration: (value, sql) => {
    const checkedDuration = checked(value, duration, 'a duration such as 5m');
    return sql ? sqlInterval(checkedDuration) : checkedDuration;
  },
  metric: (value, sql) => {
    if (sql) throw new RecipeError('A SQL recipe has no metrics.');
    return metricName(value);
  },
  table: (value, sql) => {
    if (!sql) throw new RecipeError('A PromQL recipe has no tables.');
    return sqlName(checked(value, tableName, 'a table name'));
  },
  label: (value, sql) => {
    const name = checked(value, plainName, 'a plain name');
    return sql ? sqlName(name) : name;
  },
  column: (value, sql) => {
    const name = checked(value, plainName, 'a plain name');
    return sql ? sqlName(name) : name;
  },
};

/**
 * The text a placeholder becomes.
 *
 * @param kind - The placeholder's kind.
 * @param language - The query language.
 * @param value - The value the agent gave.
 * @returns The text.
 * @throws {RecipeError} When the value does not fit its kind or its language.
 */
function paramText(
  kind: RecipeParamKind,
  language: SavedRecipe['language'],
  value: string,
): string {
  return writers[kind](value, language === 'sql');
}

/**
 * A saved recipe's query with its placeholders filled.
 *
 * @param recipe - The recipe.
 * @param params - The values by placeholder.
 * @returns The query text.
 * @throws {RecipeError} When a placeholder has no value or a value does not fit.
 */
function filled(recipe: SavedRecipe, params: Readonly<Record<string, string>>): string {
  return recipe.query.replace(/\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/g, (_match, name: string) => {
    const param = recipe.params.find((each) => each.name === name);
    const value = params[name];
    if (!param || value === undefined)
      throw new RecipeError(`${recipe.name} needs a value for ${name}.`);
    return paramText(param.kind, recipe.language, value);
  });
}

/**
 * Expands a saved recipe.
 *
 * @param request - The request: the recipe's id, its connector and its values.
 * @param saved - The saved recipes the run may use.
 * @returns The draft.
 * @throws {RecipeError} For an unknown recipe or values that do not fit.
 */
export function savedDraft(request: RecipeOf<'saved'>, saved: readonly SavedRecipe[]): PanelDraft {
  const recipe = saved.find((each) => each.id === request.name);
  if (!recipe) throw new RecipeError(`No saved recipe "${request.name}".`);
  const text = filled(recipe, request.params);
  const query: PanelQuery =
    recipe.language === 'sql'
      ? { refId: 'A', connector: request.connector, language: 'sql', sql: text }
      : { refId: 'A', connector: request.connector, language: 'promql', expr: text };
  const view = viewOfKind(recipe.show, recipe.unit, ['A'], recipe.columns, 'last');
  if (!view) throw new RecipeError(`${recipe.name} shows a table with no columns.`);
  const shape =
    view.kind === 'chart'
      ? recipe.show === 'line' || recipe.show === 'bar'
        ? 'time'
        : 'chart'
      : view.kind;
  return {
    title: request.title,
    ...(request.description === undefined ? {} : { description: request.description }),
    queries: [query],
    view,
    shape,
    width: request.width,
  };
}
