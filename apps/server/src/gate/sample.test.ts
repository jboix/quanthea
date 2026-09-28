import { describe, expect, test } from 'bun:test';
import type { AccessLevel } from '@querent/shared';
import { ConnectorError, type ConnectorInstance } from '../connectors/_shared/index.ts';
import { memoryConnector } from '../connectors/_shared/test/memory-connector.ts';
import { sampleForModel } from './sample.ts';

const instance = memoryConnector.open({ config: { rowCount: 5 }, secret: { token: 't' } });
const service = { entity: 'events', field: 'service' };

/**
 * Samples a field at a level.
 *
 * @param accessLevel - The access level.
 * @param options - Hidden fields, the limit, and another instance.
 * @returns The model sample.
 */
function sampleAt(
  accessLevel: AccessLevel,
  options: { hiddenFields?: string[]; limit?: number; from?: ConnectorInstance } = {},
) {
  const subject = {
    name: 'memory',
    kind: 'memory',
    accessLevel,
    hiddenFields: options.hiddenFields ?? [],
    descriptions: {},
  };
  return sampleForModel(
    subject,
    options.from ?? instance,
    service,
    options.limit ?? 10,
    AbortSignal.timeout(1000),
  );
}

describe('sampleForModel', () => {
  test('refuses level 1', async () => {
    expect(await sampleAt(1)).toEqual({
      ok: false,
      error: 'Sample values need access level 2 or higher; memory is at level 1.',
    });
  });

  test('returns the values of a field with few of them from level 2', async () => {
    expect(await sampleAt(2)).toEqual({
      ok: true,
      values: ['checkout-svc', 'payments-svc', 'cart-svc'],
    });
  });

  test('refuses a hidden field at every level', async () => {
    expect(await sampleAt(4, { hiddenFields: ['events.service'] })).toEqual({
      ok: false,
      error: 'events.service is hidden.',
    });
  });

  test('refuses a field with more distinct values than asked for', async () => {
    expect(await sampleAt(2, { limit: 2 })).toEqual({
      ok: false,
      error: 'events.service has more than 2 distinct values.',
    });
  });

  test('never asks the source for more than 50 values', async () => {
    let asked = 0;
    const counting: ConnectorInstance = {
      ...instance,
      sampleValues: (_field, limit) => {
        asked = limit;
        return Promise.resolve({ values: [], complete: true });
      },
    };
    await sampleAt(2, { limit: 10_000, from: counting });
    expect(asked).toBe(50);
  });

  test('gives only the safe message of a connector error', async () => {
    const failing: ConnectorInstance = {
      ...instance,
      sampleValues: () =>
        Promise.reject(
          new ConnectorError('not_found', 'Column "events.service" does not exist.', 'raw text'),
        ),
    };
    expect(await sampleAt(2, { from: failing })).toEqual({
      ok: false,
      error: 'Column "events.service" does not exist.',
    });
  });
});
