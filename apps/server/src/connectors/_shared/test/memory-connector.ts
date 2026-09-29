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

/**
 * Runs the only query the memory source knows, `SELECT * FROM events`, the table name quoted or
 * not, over its generated rows.
 *
 * @param text - The query text.
 * @param rowCount - How many rows the table holds.
 * @param context - The execution context.
 * @returns One frame of events.
 */
function runEvents(text: string, rowCount: number, context: ExecutionContext) {
  throwIfAborted(context.signal);
  if (text.trim().replace(/\s+/g, ' ').replace('"events"', 'events') !== 'SELECT * FROM events') {
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

/** A test connector kind over generated rows. `execute` understands one query: `SELECT * FROM events`. */
export const memoryConnector = defineConnector({
  kind: 'memory',
  displayName: 'Memory',
  description: 'A fixed table of events, for tests.',
  language: 'sql',
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
  open({ config }): ConnectorInstance {
    return {
      test: () =>
        Promise.resolve({ ok: true, latencyMs: 0, message: 'In memory.', readOnly: true }),
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
