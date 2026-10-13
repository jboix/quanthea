/** A panel's queries written out, for a person or a judge to read. */
import type { BuiltPanel } from '../checks/dashboard.ts';
import { panelQueries } from '../checks/dashboard.ts';

/** One query, written out, with its language. */
export interface WrittenQuery {
  /** The language, such as `sql` or `promql`. */
  readonly language: string;
  /** The connector it runs on. */
  readonly connector: string;
  /** The query. */
  readonly text: string;
}

/**
 * A query written out: its SQL or its expression, else what is left of it as JSON.
 *
 * @param query - The query, as a spec holds it.
 * @returns The query, written out.
 */
export function writtenQuery(query: object): WrittenQuery {
  const {
    sql,
    expr,
    language,
    refId: _refId,
    connector,
    ...rest
  } = query as Record<string, unknown>;
  const written = typeof expr === 'string' ? expr : JSON.stringify(rest, null, 2);
  const text = typeof sql === 'string' ? sql : written;
  return { language: String(language ?? ''), connector: String(connector ?? ''), text };
}

/**
 * A panel's queries, written out for reading.
 *
 * @param panel - The panel.
 * @returns Its queries.
 */
export function queriesOf(panel: BuiltPanel): WrittenQuery[] {
  return panelQueries(panel).map(writtenQuery);
}
