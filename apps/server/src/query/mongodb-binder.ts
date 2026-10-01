/**
 * Binds variables into a MongoDB aggregation template. A variable is a JSON node,
 * `{"$var": "service"}`, replaced by the value as a JSON value, as in a search body. Operator keys
 * pass, since a pipeline is made of them, but no stage may write (`$out`, `$merge`), watch or list
 * the server's sessions and operations, and no operator may run JavaScript (`$where`, `$function`,
 * `$accumulator`).
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
 * @throws {QueryError} `invalid` for a malformed collection or stage, a refused key, or an unknown
 *   variable.
 */
export function bindMongodb(
  template: MongodbTemplate,
  variables: Variables,
  timeRange: TimeRange,
): MongodbQuery {
  if (!collectionName.test(template.collection))
    throw new QueryError(
      'invalid',
      'A collection is letters, digits, _, - and ., and not a system collection.',
    );
  checkStages(template.pipeline);
  const { pipeline } = bindJsonVariables(
    { pipeline: template.pipeline },
    { variables, builtIns: builtInsOf(timeRange), checkKey: refuseKey, operatorKeys: true },
  ) as { pipeline: Record<string, unknown>[] };
  return { language: 'mongodb', collection: template.collection, pipeline };
}
