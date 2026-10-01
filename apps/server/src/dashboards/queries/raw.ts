/**
 * Raw queries: the query text the model wrote, read into a panel query for its language. Saved
 * queries reuse the readers once their placeholders are filled.
 */
import {
  type PanelQuery,
  panelQuerySchema,
  type QueryLanguage,
  queryLanguageNames,
} from '@querent/shared';
import type { BuiltData } from './built.ts';
import type { DataOf } from './request.ts';
import { QueryError } from './text.ts';

/**
 * A raw query as the model wrote it: its columns are known once it runs.
 *
 * @param request - The request.
 * @returns The query and its output.
 */
export function rawData(request: DataOf<'raw'>): BuiltData {
  return {
    queries: [rawQuery(request)],
    output: { shape: 'rows', columns: [], chart: 'table.rows' },
  };
}

/**
 * The panel query of a raw query.
 *
 * @param request - The request.
 * @returns The query, refId A.
 * @throws {QueryError} For a search body that is not a JSON object.
 */
function rawQuery(request: DataOf<'raw'>): PanelQuery {
  const { connector, language, query, instant } = request;
  if (language === 'sql') return { refId: 'A', connector, language, sql: query };
  if (language === 'search')
    return {
      refId: 'A',
      connector,
      language,
      index: request.index ?? '',
      body: jsonObject(query, 'search body'),
    };
  if (language === 'http' || language === 'mongodb')
    return templateQuery(connector, language, jsonObject(query, `${language} query`));
  if (language === 'redis') return redisQuery(connector, query);
  return { refId: 'A', connector, language, expr: query, ...(instant ? { instant: true } : {}) };
}

/**
 * Reads a JSON object a raw query gives as text.
 *
 * @param text - The JSON text.
 * @param what - What it is, for the message.
 * @returns The object.
 * @throws {QueryError} When the text is not a JSON object.
 */
export function jsonObject(text: string, what: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new QueryError(`The ${what} is not valid JSON.`);
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new QueryError(`The ${what} is a JSON object.`);
  return value as Record<string, unknown>;
}

/**
 * The panel query of a template's fields: an HTTP request's method, path, query, body and extract,
 * a MongoDB collection and pipeline, a search's index and body, a Redis command and arguments.
 *
 * @param connector - The connector.
 * @param language - The language.
 * @param fields - The template without its connector, language and refId.
 * @returns The query, refId A.
 * @throws {QueryError} When the fields are not a template of the language.
 */
export function templateQuery(
  connector: string,
  language: QueryLanguage,
  fields: Readonly<Record<string, unknown>>,
): PanelQuery {
  const parsed = panelQuerySchema.safeParse({ ...fields, refId: 'A', connector, language });
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  throw new QueryError(
    `The ${queryLanguageNames[language]} query is invalid at ${issue?.path.join('.') || 'its root'}: ${issue?.message ?? ''}`,
  );
}

/**
 * The panel query of a raw Redis query: the command and its arguments separated by spaces, or a
 * JSON array of them when an argument holds a space.
 *
 * @param connector - The connector.
 * @param text - The command line, or its JSON array.
 * @returns The query, refId A.
 * @throws {QueryError} When the text names no command.
 */
function redisQuery(connector: string, text: string): PanelQuery {
  const [command, ...args] = redisWords(text);
  if (!command) throw new QueryError('A Redis query names a command, such as ZREVRANGE.');
  return { refId: 'A', connector, language: 'redis', command, args };
}

/**
 * The words of a raw Redis query.
 *
 * @param text - The command line, or the JSON array of its words.
 * @returns The words.
 * @throws {QueryError} When the text is a JSON array that does not parse.
 */
export function redisWords(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed.startsWith('[')) return trimmed.split(/\s+/).filter(Boolean);
  try {
    return (JSON.parse(trimmed) as unknown[]).map(String);
  } catch {
    throw new QueryError('The Redis command is not a valid JSON array.');
  }
}
