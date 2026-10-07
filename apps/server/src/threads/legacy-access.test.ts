import { expect, test } from 'bun:test';
import type { SourceAccess } from '@quanthea/shared';
import { legacyAccessParts } from './legacy-access.ts';

/**
 * The access of the connectors `orders` and `metrics`.
 *
 * @param name - The connector name.
 * @returns Its access, or none for another name.
 */
function accessOf(name: string): SourceAccess | undefined {
  if (name !== 'orders' && name !== 'metrics') return undefined;
  return { connectorId: `id-${name}`, level: 2, hidden: [] };
}

test('records each connector a data tool call named, at any depth, once', () => {
  const edit = {
    type: 'tool-edit_dashboard',
    input: { panels: [{ queries: [{ connector: 'orders' }, { connector: 'metrics' }] }] },
  };
  const describe = { type: 'tool-describe', input: { connector: 'orders' } };
  const records = legacyAccessParts([edit, describe, { type: 'text', text: 'orders' }], accessOf);
  expect(records.map((part) => part.data.connectorId)).toEqual(['id-orders', 'id-metrics']);
  expect(records[0]?.type).toBe('data-sourceAccess');
});

test('ignores tools that read no data and connectors that are gone', () => {
  const plan = { type: 'tool-propose_plan', input: { connector: 'orders' } };
  const gone = { type: 'tool-sample_values', input: { connector: 'old' } };
  expect(legacyAccessParts([plan, gone, null, 'text'], accessOf)).toEqual([]);
});
