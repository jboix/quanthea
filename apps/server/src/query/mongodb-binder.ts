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
import { chosenSeconds } from './interval.ts';
import { bindJsonVariables } from './json-variables.ts';
import { foreignReads } from './mongodb-reads.ts';
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

/** A collection name of a connector that shows its database's `system.` collections. */
const anyCollectionName = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,119}$/;

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
 * @param shape - What a name may be: {@link collectionName}, or {@link anyCollectionName}.
 * @throws {QueryError} `invalid` for anything but a name of that shape.
 */
function checkCollection(name: unknown, shape: RegExp): void {
  if (typeof name !== 'string' || !shape.test(name)) throw collectionError();
}

/**
 * Checks every collection a bound pipeline reads besides its own, in nested pipelines too. A
 * stage that names none, such as a `$lookup` or `$unionWith` on `$documents`, reads no collection.
 *
 * @param node - The pipeline or a part of it.
 * @param shape - What a collection name may be.
 * @throws {QueryError} `invalid` for a system collection, a malformed name or another database.
 */
function checkCollections(node: unknown, shape: RegExp): void {
  for (const read of foreignReads(node)) {
    if (read.otherDatabase) throw collectionError();
    if (read.named) checkCollection(read.collection, shape);
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
 * @param interval - The interval the charts are cut into, when one was chosen.
 * @returns The values by name.
 */
function builtInsOf(timeRange: TimeRange, interval?: string): Readonly<Record<string, unknown>> {
  return {
    __from: { $date: timeRange.from.toISOString() },
    __to: { $date: timeRange.to.toISOString() },
    __interval_ms: (chosenSeconds(interval) ?? bucketSeconds(timeRange)) * 1000,
  };
}

/**
 * Binds a MongoDB template.
 *
 * @param template - The collection and the pipeline.
 * @param variables - The variable values.
 * @param timeRange - The time range, for `__from`, `__to` and `__interval_ms`.
 * @param showSystem - Whether the connector shows its database's `system.` collections.
 * @param interval - The interval the charts are cut into, when one was chosen: `__interval_ms`.
 * @returns The bound query.
 * @throws {QueryError} `invalid` for a malformed or system collection, read first or by a stage, a
 *   malformed stage, a refused key, or an unknown variable.
 */
export function bindMongodb(
  template: MongodbTemplate,
  variables: Variables,
  timeRange: TimeRange,
  showSystem = false,
  interval?: string,
): MongodbQuery {
  const shape = showSystem ? anyCollectionName : collectionName;
  checkCollection(template.collection, shape);
  checkStages(template.pipeline);
  const { pipeline } = bindJsonVariables(
    { pipeline: template.pipeline },
    {
      variables,
      builtIns: builtInsOf(timeRange, interval),
      checkKey: refuseKey,
      operatorKeys: true,
      placeValue,
    },
  ) as { pipeline: Record<string, unknown>[] };
  checkCollections(pipeline, shape);
  return { language: 'mongodb', collection: template.collection, pipeline };
}
