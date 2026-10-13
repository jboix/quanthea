/** An in-memory connector kind for tests: a fixed table of events, queried by name. */
import { z } from 'zod';
import {
  ConnectorError,
  type ConnectorInstance,
  createFrameBuilder,
  defineConnector,
  type ExecutionContext,
} from '../index.ts';

/** The services that appear in the events table. */
const memoryServices = ['checkout-svc', 'payments-svc', 'cart-svc'];

/**
 * Throws the abort error when the signal fired.
 *
 * @param signal - The call's signal.
 * @throws {ConnectorError} `timeout` when aborted.
 */
function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new ConnectorError('timeout', 'The query was cancelled.');
}

/** The queries the memory source knows: every event, with or without a bucketed time first. */
const eventsQuery = /^SELECT (?:.+ AS time, )?\* FROM events$/;

/**
 * Runs the only query the memory source knows, `SELECT * FROM events`, the table name quoted or
 * not, over its generated rows. A bucket written before the star, such as
 * `SELECT date_trunc('hour', time) AS time, * FROM events`, is accepted and not applied: the rows
 * are the same.
 *
 * @param text - The query text.
 * @param rowCount - How many rows the table holds.
 * @param context - The execution context.
 * @returns One frame of events.
 */
function runEvents(text: string, rowCount: number, context: ExecutionContext) {
  throwIfAborted(context.signal);
  if (!eventsQuery.test(text.trim().replace(/\s+/g, ' ').replace('"events"', 'events'))) {
    throw new ConnectorError('syntax', 'Unknown query.', `Unknown query "${text}".`);
  }
  const builder = createFrameBuilder({
    refId: context.refId,
    fields: [
      { name: 'time', type: 'time' },
      { name: 'service', type: 'string' },
      { name: 'errors', type: 'number' },
    ],
    maxRows: context.maxRows,
  });
  const start = context.timeRange.from.getTime();
  for (let row = 0; row < rowCount; row += 1) {
    if (!builder.add([start + row * 60_000, memoryServices[row % 3], row * 2])) break;
  }
  return [builder.build(0)];
}

/** The token of the memory connector whose credentials the connection test reports as able to write. */
const memoryWriterToken = 'memory-writer-token';

/** What the connection test says of {@link memoryWriterToken}. */
const writerHealth = {
  ok: true,
  latencyMs: 0,
  message: 'In memory. The token can write.',
  readOnly: false,
  canDo: ['It can insert, update or delete in 1 table: events.'],
  readOnlySetup: 'CREATE ROLE quanthea_read;',
};

/** A test connector kind over generated rows. `execute` understands one query: `SELECT * FROM events`. */
export const memoryConnector = defineConnector({
  kind: 'memory',
  displayName: 'Memory',
  language: 'sql',
  dialect: 'postgres',
  configSchema: z.object({
    rowCount: z
      .number()
      .int()
      .min(0)
      .default(5)
      .meta({ title: 'Rows', description: 'Rows in the table.' }),
  }),
  secretSchema: z.object({
    token: z.string().min(1).meta({ title: 'Token', description: 'Any non-empty string.' }),
  }),
  open({ config, secret }): ConnectorInstance {
    const reader = { ok: true, latencyMs: 0, message: 'In memory.', readOnly: true };
    return {
      test: () => Promise.resolve(secret.token === memoryWriterToken ? writerHealth : reader),
      describe: () =>
        Promise.resolve({
          entities: [
            {
              name: 'events',
              kind: 'table',
              rowEstimate: config.rowCount,
              fields: [
                { name: 'time', nativeType: 'timestamp', type: 'time' },
                { name: 'service', nativeType: 'text', type: 'string', distinctEstimate: 3 },
                { name: 'errors', nativeType: 'integer', type: 'number' },
              ],
            },
          ],
        }),
      sampleValues: (_field, limit) =>
        Promise.resolve({
          values: memoryServices.slice(0, limit),
          complete: limit >= memoryServices.length,
        }),
      execute: (query, context) =>
        query.language === 'sql'
          ? Promise.resolve().then(() => runEvents(query.text, config.rowCount, context))
          : Promise.reject(new ConnectorError('rejected', 'The memory connector runs SQL only.')),
      close: () => Promise.resolve(),
    };
  },
});

/**
 * The memory kind as a search kind, for what only a search connector has, such as bucket scripts.
 * It runs no search.
 */
export const memorySearchConnector = defineConnector({
  kind: 'memory-search',
  displayName: 'Memory search',
  language: 'search',
  queryGuide: 'Memory search. A query is an index and a JSON body.',
  configSchema: memoryConnector.configSchema,
  secretSchema: memoryConnector.secretSchema,
  open: (options) => memoryConnector.open(options),
});
