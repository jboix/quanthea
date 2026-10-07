/**
 * Binds variables into a MongoDB aggregation template. A variable is a JSON node,
 * `{"$var": "service"}`, replaced by the value as a JSON value, as in a search body. Operator keys
 * pass, since a pipeline is made of them, but no stage may write (`$out`, `$merge`), watch, list
 * the server's sessions, operations or catalog, and no operator may run JavaScript (`$where`,
 * `$function`, `$accumulator`). Every collection read, by `$lookup`, `$graphLookup` and
 * `$unionWith` too, is one of the connector's database and never a `system.` one. A value that
 * starts with `$` goes in `$literal` wherever MongoDB would read it as a field.
 */
import {
  type MongodbQuery,
  mongodbRefusedKeys,
  type TimeRange,
} from '../connectors/_shared/index.ts';
import { bindJsonVariables } from './json-variables.ts';
import { QueryError } from './query-error.ts';
import { bucketSeconds } from './search-binder.ts';
import type { Variables } from './variables.ts';

/** The MongoDB template of a panel query. */
export interface MongodbTemplate {
  /** The collection the pipeline starts from. */
  readonly collection: string;
  /** The stages, with `{"$var": "name"}` nodes. */
  readonly pipeline: readonly Readonly<Record<string, unknown>>[];
}

/** A collection name: no system collection, no namespace tricks. */
const collectionName = /^(?!system\.)[A-Za-z0-9_][A-Za-z0-9_.-]{0,119}$/;

/** The stages that read another collection, with the key of their object that names it. */
const foreignKeys: ReadonlyMap<string, string> = new Map([
  ['$lookup', 'from'],
  ['$graphLookup', 'from'],
  ['$unionWith', 'coll'],
]);

/**
 * The error for a collection a query may not read.
 *
 * @returns The error.
 */
function collectionError(): QueryError {
  return new QueryError(
    'invalid',
    "A collection is letters, digits, _, - and ., in the connector's database, and not a system collection.",
  );
}

/**
 * Checks a collection name.
 *
 * @param name - The name, as the query gives it.
 * @throws {QueryError} `invalid` for anything but a name that is not a system collection.
 */
function checkCollection(name: unknown): void {
  if (typeof name !== 'string' || !collectionName.test(name)) throw collectionError();
}

/**
 * Checks the collection a stage reads besides the pipeline's own: `$lookup.from`,
 * `$graphLookup.from` and `$unionWith`, as a name or as `coll`. A stage that names none, such as
 * a `$lookup` or `$unionWith` on `$documents`, reads no collection.
 *
 * @param key - The key, such as `$lookup`.
 * @param value - Its value.
 * @throws {QueryError} `invalid` for a system collection, a malformed name or another database.
 */
function checkForeign(key: string, value: unknown): void {
  if (key === '$unionWith' && typeof value === 'string') {
    checkCollection(value);
    return;
  }
  const field = foreignKeys.get(key);
  if (field === undefined || value === null || typeof value !== 'object') return;
  if ('db' in value) throw collectionError();
  if (!(field in value)) return;
  checkCollection((value as Readonly<Record<string, unknown>>)[field]);
}

/**
 * Checks every collection a bound pipeline reads, in nested pipelines too.
 *
 * @param node - The pipeline or a part of it.
 * @throws {QueryError} `invalid` for a system collection, a malformed name or another database.
 */
function checkCollections(node: unknown): void {
  if (node === null || typeof node !== 'object') return;
  for (const [key, value] of Object.entries(node)) {
    checkForeign(key, value);
    checkCollections(value);
  }
}

/**
 * Whether a value holds a string that MongoDB reads as a field or a variable in an expression,
 * such as `$secret` or `$$ROOT`.
 *
 * @param value - A variable's value.
 * @returns `true` when it does.
 */
function readsField(value: unknown): boolean {
  return [value].flat().some((item) => typeof item === 'string' && item.startsWith('$'));
}

/**
 * Whether a node sits in a query, where a string is always a value: under `$match` and not under
 * an `$expr` within it.
 *
 * @param keys - The keys down to the node.
 * @returns `true` in a query.
 */
function inQuery(keys: readonly string[]): boolean {
  const match = keys.lastIndexOf('$match');
  return match >= 0 && !keys.slice(match).includes('$expr');
}

/**
 * A variable's value as the pipeline takes it: in `$literal` when it would otherwise read a field,
 * so a viewer's `$secret` stays the string it is.
 *
 * @param value - The value.
 * @param keys - The keys down to the variable.
 * @returns The value, or `{"$literal": value}`.
 */
function placeValue(value: unknown, keys: readonly string[]): unknown {
  if (!readsField(value) || keys.at(-1) === '$literal' || inQuery(keys)) return value;
  return { $literal: value };
}

/**
 * Checks one key of the pipeline.
 *
 * @param key - The key.
 * @throws {QueryError} `invalid` for a key that writes, waits or runs JavaScript.
 */
function refuseKey(key: string): void {
  const reason = mongodbRefusedKeys.get(key);
  if (reason) throw new QueryError('invalid', `A query only reads; "${key}" ${reason}.`);
}

/**
 * Checks that every stage is an object with one `$` key, such as `{"$match": {…}}`.
 *
 * @param pipeline - The stages.
 * @throws {QueryError} `invalid` for a stage of another shape.
 */
function checkStages(pipeline: readonly unknown[]): void {
  for (const [index, stage] of pipeline.entries()) {
    const keys = stage && typeof stage === 'object' ? Object.keys(stage) : [];
    if (Array.isArray(stage) || keys.length !== 1 || !keys[0]?.startsWith('$'))
      throw new QueryError(
        'invalid',
        `Stage ${index + 1} is not one stage; write it as {"$match": {…}}, one key per stage.`,
      );
  }
}

/**
 * The built-in values: the time range as Extended JSON dates, and the bucket width in
 * milliseconds that keeps the range within 1000 buckets.
 *
 * @param timeRange - The time range.
 * @returns The values by name.
 */
function builtInsOf(timeRange: TimeRange): Readonly<Record<string, unknown>> {
  return {
    __from: { $date: timeRange.from.toISOString() },
    __to: { $date: timeRange.to.toISOString() },
    __interval_ms: bucketSeconds(timeRange) * 1000,
  };
}

/**
 * Binds a MongoDB template.
 *
 * @param template - The collection and the pipeline.
 * @param variables - The variable values.
 * @param timeRange - The time range, for `__from`, `__to` and `__interval_ms`.
 * @returns The bound query.
 * @throws {QueryError} `invalid` for a malformed or system collection, read first or by a stage, a
 *   malformed stage, a refused key, or an unknown variable.
 */
export function bindMongodb(
  template: MongodbTemplate,
  variables: Variables,
  timeRange: TimeRange,
): MongodbQuery {
  checkCollection(template.collection);
  checkStages(template.pipeline);
  const { pipeline } = bindJsonVariables(
    { pipeline: template.pipeline },
    {
      variables,
      builtIns: builtInsOf(timeRange),
      checkKey: refuseKey,
      operatorKeys: true,
      placeValue,
    },
  ) as { pipeline: Record<string, unknown>[] };
  checkCollections(pipeline);
  return { language: 'mongodb', collection: template.collection, pipeline };
}
