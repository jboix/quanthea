import { expect, test } from 'bun:test';
import type { DefinitionVersion } from '@quanthea/shared';
import { statusOf, wordsOfValue } from './definition-view.tsx';

test('a list row says where a definition is checked, and its version', () => {
  const body = { shape: 'ratio', request: { kind: 'search-ratio' } };
  const version = (bodies: unknown[]) =>
    ({ definition: { bodies }, version: 3 }) as unknown as DefinitionVersion;
  expect(statusOf(version([body]))).toBe('Checked · search · v3');
  expect(statusOf(version([]))).toBe('Meaning only · v3');
});

test('a body field reads as words: filters joined by and, anything else as it is', () => {
  const filters = [
    { field: 'event_name', value: 'ERROR' },
    { field: 'data.blocked', op: '!=', value: 'true' },
  ];
  expect(wordsOfValue(filters)).toBe('event_name = "ERROR" and data.blocked != "true"');
  expect(wordsOfValue('core_events')).toBe('core_events');
  expect(wordsOfValue({ fn: 'count' })).toBe('{"fn":"count"}');
});
