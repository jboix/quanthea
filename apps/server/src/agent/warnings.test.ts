import { afterEach, expect, test } from 'bun:test';
import { captureLogs } from '../test/fixtures.ts';
import { routeModelWarnings } from './warnings.ts';

afterEach(() => {
  globalThis.AI_SDK_LOG_WARNINGS = undefined;
});

test('routes model warnings to the logger', () => {
  const { logger, lines } = captureLogs();
  routeModelWarnings(logger);
  const warning = { type: 'unsupported' as const, feature: 'responseFormat' };
  const log = globalThis.AI_SDK_LOG_WARNINGS;
  if (typeof log !== 'function') throw new Error('No warning logger was set.');
  log({ warnings: [warning], provider: 'gateway.chat', model: 'gemma' });
  expect(lines).toEqual([
    expect.objectContaining({
      level: 'warn',
      message: 'model warning',
      provider: 'gateway.chat',
      model: 'gemma',
    }),
  ]);
});
