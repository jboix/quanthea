import { expect, test } from 'bun:test';
import { connectorKinds, findConnectorKind } from './registry.ts';

test('every connector kind has its own identifier', () => {
  const identifiers = connectorKinds.map((kind) => kind.kind);
  expect(new Set(identifiers).size).toBe(identifiers.length);
});

test('finds a kind by identifier', () => {
  expect(findConnectorKind('postgres')?.displayName).toBe('PostgreSQL');
  expect(findConnectorKind('oracle')).toBeUndefined();
});
