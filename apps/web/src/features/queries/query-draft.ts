/**
 * A saved recipe as the editor holds it: text fields, the placeholders' kinds by name, and the
 * columns as one line. The placeholders come from the query, so the admin only types kinds.
 */
import {
  placeholdersOf,
  type QueryParamKind,
  type SavedQuery,
  savedQuerySchema,
} from '@querent/shared';

/** A saved recipe being edited. */
export interface QueryDraft {
  /** The id, as the agent names it. */
  readonly id: string;
  /** The name. */
  readonly name: string;
  /** What it shows. */
  readonly description: string;
  /** The query language. */
  readonly language: SavedQuery['language'];
  /** The query, with `{{placeholders}}`. */
  readonly query: string;
  /** Each placeholder's kind and description, by name. */
  readonly params: Readonly<Record<string, { kind: QueryParamKind; description: string }>>;
  /** How the panel shows. */
  readonly show: SavedQuery['show'];
  /** The unit. */
  readonly unit: SavedQuery['unit'];
  /** A table's columns, separated by commas. */
  readonly columns: string;
}

/** A new recipe, with a PromQL example to start from. */
export const newDraft: QueryDraft = {
  id: '',
  name: '',
  description: '',
  language: 'promql',
  query: 'sum by ({{label}}) (rate({{metric}}[{{window}}]))',
  params: {},
  show: 'line',
  unit: 'number',
  columns: '',
};

/** The kind a placeholder's name suggests, tried in order. */
const kindHints: readonly [RegExp, QueryParamKind][] = [
  [/metric/, 'metric'],
  [/table/, 'table'],
  [/column|field/, 'column'],
  [/label|^by$|group/, 'label'],
  [/window|interval|duration|step/, 'duration'],
];

/**
 * The kind a placeholder likely has, from its name.
 *
 * @param name - Such as `metric` or `window`.
 * @returns The kind; `value` when nothing matches.
 */
export function guessKind(name: string): QueryParamKind {
  return kindHints.find(([pattern]) => pattern.test(name))?.[1] ?? 'value';
}

/**
 * The placeholders of a draft's query, with their kinds: the ones set, or guessed from the name.
 *
 * @param draft - The draft.
 * @returns The placeholders, in the order the query names them.
 */
export function paramsOf(draft: QueryDraft): SavedQuery['params'] {
  return placeholdersOf(draft.query).map((name) => ({
    name,
    kind: draft.params[name]?.kind ?? guessKind(name),
    description: draft.params[name]?.description ?? '',
  }));
}

/**
 * A saved recipe as a draft.
 *
 * @param recipe - The recipe.
 * @returns The draft.
 */
export function draftOf(recipe: SavedQuery): QueryDraft {
  const params = Object.fromEntries(
    recipe.params.map(({ name, kind, description }) => [name, { kind, description }]),
  );
  return { ...recipe, params, columns: recipe.columns?.join(', ') ?? '' };
}

/**
 * An id from a name, such as `queue-depth` from "Queue depth".
 *
 * @param name - The name.
 * @returns The id.
 */
export function idOf(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/**
 * Checks a draft as the server will.
 *
 * @param draft - The draft.
 * @returns The recipe, or the problems by field.
 */
export function recipeOf(
  draft: QueryDraft,
): { ok: true; recipe: SavedQuery } | { ok: false; issues: Record<string, string> } {
  const columns = draft.columns
    .split(',')
    .map((column) => column.trim())
    .filter((column) => column !== '');
  const { params: _params, columns: _columns, ...fields } = draft;
  const parsed = savedQuerySchema.safeParse({
    ...fields,
    params: paramsOf(draft),
    ...(draft.show === 'table' ? { columns } : {}),
  });
  if (parsed.success) return { ok: true, recipe: parsed.data };
  const issues = parsed.error.issues.map((issue) => [String(issue.path[0] ?? ''), issue.message]);
  return { ok: false, issues: Object.fromEntries(issues.reverse()) };
}
