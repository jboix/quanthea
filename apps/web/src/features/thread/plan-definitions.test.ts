import { expect, test } from 'bun:test';
import type { DefinitionVersion, Plan } from '@quanthea/shared';
import { definitionMarkOf } from './plan-definitions.ts';

const errorRate = {
  definition: {
    id: 'error-rate',
    name: 'Error rate',
    bodies: [{ shape: 'ratio', request: { kind: 'search-ratio' } }],
  },
  version: 3,
} as unknown as DefinitionVersion;

/**
 * A plan panel.
 *
 * @param fields - What differs.
 * @returns The panel.
 */
const panel = (fields: Partial<Plan['panels'][number]>): Plan['panels'][number] => ({
  kind: 'line',
  title: 'Error rate',
  language: 'search',
  connector: 'events',
  ...fields,
});

test('a plan panel says the definition it follows, checked or from the meaning', () => {
  expect(definitionMarkOf(panel({ definition: 'error-rate' }), [errorRate])).toEqual({
    text: 'Error rate · checked v3',
    tone: 'ok',
  });
  expect(
    definitionMarkOf(panel({ definition: 'error-rate', language: 'promql' }), [errorRate]),
  ).toEqual({
    text: 'Error rate · from the meaning',
    tone: 'draft',
  });
  expect(definitionMarkOf(panel({ definition: 'churn' }), [errorRate])?.tone).toBe('danger');
  expect(definitionMarkOf(panel({}), [errorRate])).toBeUndefined();
});
