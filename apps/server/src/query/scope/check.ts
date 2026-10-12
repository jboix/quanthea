/**
 * Checks a bound query against what its connector shows, from the query's own text: the tables of
 * a SQL statement, the metrics of a PromQL expression, the collections of a MongoDB pipeline, the
 * keys of a Redis command, the endpoint of an HTTP request, and the indices a search names in
 * full. An index pattern is resolved when the query runs, in `search-scope.ts`.
 */
import { listShowsObject } from '@quanthea/shared';
import type {
  BoundQuery,
  HttpQuery,
  MongodbQuery,
  RedisQuery,
} from '../../connectors/_shared/index.ts';
import { QueryError } from '../query-error.ts';
import type { SqlFlavor } from '../sql-dialects.ts';
import { notShown, type ObjectScope, requireShown, restricts } from './object-scope.ts';
import { promqlReads } from './promql-metrics.ts';
import { checkSqlScope } from './sql-scope.ts';

/** The one object a Loki connector has, as its schema lists it. */
const lokiObject = 'logs';

/** The Redis commands that read no key. */
const keylessCommands: ReadonlySet<string> = new Set(['INFO', 'DBSIZE']);

/** The Redis commands whose every argument is a key. */
const manyKeyCommands: ReadonlySet<string> = new Set(['MGET', 'EXISTS']);

/** The stages that read another collection, with the key of their object that names it. */
const foreignKeys: ReadonlyMap<string, string> = new Map([
  ['$lookup', 'from'],
  ['$graphLookup', 'from'],
  ['$unionWith', 'coll'],
]);

/**
 * The collection a stage reads besides the pipeline's own, if it names one.
 *
 * @param key - A key of the pipeline, such as `$lookup`.
 * @param value - Its value.
 * @returns The collection's name, or `undefined`.
 */
function foreignCollection(key: string, value: unknown): string | undefined {
  if (key === '$unionWith' && typeof value === 'string') return value;
  const field = foreignKeys.get(key);
  if (field === undefined || value === null || typeof value !== 'object') return undefined;
  const name = (value as Readonly<Record<string, unknown>>)[field];
  return typeof name === 'string' ? name : undefined;
}

/**
 * Every collection a part of a pipeline reads, in nested pipelines too.
 *
 * @param node - The pipeline or a part of it.
 * @returns The collections' names.
 */
function foreignCollections(node: unknown): string[] {
  if (node === null || typeof node !== 'object') return [];
  return Object.entries(node).flatMap(([key, value]) => {
    const name = foreignCollection(key, value);
    return [...(name === undefined ? [] : [name]), ...foreignCollections(value)];
  });
}

/**
 * The collections a MongoDB aggregation reads.
 *
 * @param query - The bound query.
 * @returns The pipeline's collection and the ones its stages join or append.
 */
function mongodbObjects(query: MongodbQuery): string[] {
  return [query.collection, ...foreignCollections(query.pipeline)];
}

/**
 * The keys a Redis command reads.
 *
 * @param query - The bound query.
 * @returns The keys: none for server information, every argument of MGET and EXISTS, the first
 *   argument otherwise.
 */
function redisObjects(query: RedisQuery): string[] {
  if (keylessCommands.has(query.command)) return [];
  return manyKeyCommands.has(query.command) ? [...query.args] : query.args.slice(0, 1);
}

/**
 * A request path as people read it, with its percent escapes decoded where they can be.
 *
 * @param path - The encoded path.
 * @returns The decoded path, or the path itself when it does not decode.
 */
function readablePath(path: string): string {
  try {
    return decodeURI(path);
  } catch {
    return path;
  }
}

/**
 * Checks an HTTP request: its endpoint is `GET /path`, and a `{parameter}` of a listed name stands
 * for any text.
 *
 * @param scope - The connector's scope.
 * @param query - The bound query.
 * @throws {QueryError} `invalid` for an endpoint the connector does not show.
 */
function checkHttp(scope: ObjectScope, query: HttpQuery): void {
  const endpoint = `${query.method} ${readablePath(query.path)}`;
  const names = scope.visibility.names.map((name) => name.replace(/\{[^{}]*\}/g, '*'));
  if (!listShowsObject({ mode: scope.visibility.mode, names }, endpoint)) throw notShown(endpoint);
}

/**
 * Checks a PromQL expression: every metric it names is shown, and no selector reads metrics it
 * does not name.
 *
 * @param scope - The connector's scope.
 * @param expression - The bound expression.
 * @throws {QueryError} `invalid` for a hidden metric or a selector without a metric name.
 */
function checkPromql(scope: ObjectScope, expression: string): void {
  const reads = promqlReads(expression);
  for (const metric of reads.metrics) requireShown(scope, metric);
  if (!reads.unnamed) return;
  throw new QueryError(
    'invalid',
    'Name the metric of each selector: one without a name, or with a pattern on __name__, can read metrics this connector does not show.',
  );
}

/**
 * Checks the indices a search names in full. A pattern is resolved when the query runs.
 *
 * @param scope - The connector's scope.
 * @param index - The index expression.
 * @throws {QueryError} `invalid` for an index the connector does not show.
 */
function checkSearchNames(scope: ObjectScope, index: string): void {
  const named = index.split(',').filter((item) => !(item.startsWith('-') || item.includes('*')));
  for (const item of named) requireShown(scope, item);
}

/**
 * Refuses the first of several objects the connector does not show.
 *
 * @param scope - The connector's scope.
 * @param names - The objects' names.
 * @throws {QueryError} `invalid` for a hidden object.
 */
function requireAllShown(scope: ObjectScope, names: readonly string[]): void {
  for (const name of names) requireShown(scope, name);
}

/**
 * Checks the objects a query names, by its language.
 *
 * @param scope - The connector's scope.
 * @param query - The bound query.
 * @param dialect - The connector's SQL dialect, when it runs SQL.
 */
function checkNamed(scope: ObjectScope, query: BoundQuery, dialect: SqlFlavor | undefined): void {
  switch (query.language) {
    case 'sql':
      checkSqlScope(scope, query.text, dialect);
      break;
    case 'promql':
      checkPromql(scope, query.expr);
      break;
    case 'logql':
      requireShown(scope, lokiObject);
      break;
    case 'search':
      checkSearchNames(scope, query.index);
      break;
    case 'http':
      checkHttp(scope, query);
      break;
    case 'redis':
      requireAllShown(scope, redisObjects(query));
      break;
    default:
      requireAllShown(scope, mongodbObjects(query));
  }
}

/**
 * Checks a bound query against what its connector shows.
 *
 * @param scope - The connector's scope.
 * @param query - The bound query.
 * @param dialect - The connector's SQL dialect, when it runs SQL.
 * @throws {QueryError} `invalid` when the query names an object the connector does not show.
 */
export function checkScope(
  scope: ObjectScope,
  query: BoundQuery,
  dialect?: SqlFlavor | undefined,
): void {
  if (restricts(scope)) checkNamed(scope, query, dialect);
}
