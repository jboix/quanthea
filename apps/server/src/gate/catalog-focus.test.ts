import { describe, expect, test } from 'bun:test';
import { connectorCatalog } from './catalog.ts';
import { focusedEntities } from './catalog-focus.ts';
import type { ModelEntity } from './model-schema.ts';

/**
 * A metric with labels.
 *
 * @param name - Its name.
 * @param labels - Its label names.
 * @returns The entity.
 */
function metric(name: string, labels: string[] = []): ModelEntity {
  return { name, kind: 'metric', fields: labels.map((label) => ({ name: label, type: 'label' })) };
}

/** A big source: 100 unrelated metrics around three that matter. */
const big: ModelEntity[] = [
  ...Array.from({ length: 50 }, (_, index) => metric(`node_cpu_${index}`)),
  metric('http_requests_total', ['service', 'code']),
  metric('http_request_duration_seconds_bucket', ['service', 'le']),
  ...Array.from({ length: 50 }, (_, index) => metric(`node_disk_${index}`)),
  metric('orders_failed_total', ['reason']),
];

describe('focusedEntities', () => {
  test('lists every entity of a small source', () => {
    const small = big.slice(0, 40);
    expect(focusedEntities(small, 'http errors')).toBe(small);
  });

  test('keeps a big source to what the questions are about, in catalog order', () => {
    const kept = focusedEntities(big, 'What is the error rate of HTTP requests by service?');
    expect(kept.map((entity) => entity.name)).toEqual([
      'http_requests_total',
      'http_request_duration_seconds_bucket',
    ]);
    expect(focusedEntities(big, 'failed orders by reason').map((entity) => entity.name)).toEqual([
      'orders_failed_total',
    ]);
  });

  test('lists the first entities when nothing matches', () => {
    expect(focusedEntities(big, 'hello').length).toBe(25);
  });

  test('says how many more there are', () => {
    const source = {
      subject: {
        id: 'c-prom',
        name: 'prom',
        kind: 'prometheus',
        accessLevel: 2,
        hiddenFields: [],
        descriptions: {},
      },
      language: 'promql',
      access: 'level 2',
    } as const;
    const kept = focusedEntities(big, 'http requests');
    expect(connectorCatalog(source, kept, new Map(), big.length)).toContain(
      '(101 more: call describe with a scope to see them)',
    );
  });
});
