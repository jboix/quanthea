import { expect, test } from 'bun:test';
import { defineConnector } from './connector-kind.ts';
import { memoryConnector } from './test/memory-connector.ts';

test('defineConnector rejects an identifier that is not lowercase with dashes', () => {
  expect(() => defineConnector({ ...memoryConnector, kind: 'My Source' })).toThrow(
    'must be lowercase letters, digits and dashes',
  );
});
