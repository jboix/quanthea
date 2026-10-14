import { expect, test } from 'bun:test';
import type { DefinitionVersion } from '@quanthea/shared';
import { definitionLines } from './panel-definition.tsx';

const current = {
  definition: { id: 'error-rate', name: 'Error rate', meaning: 'ERROR over START.' },
  version: 4,
} as unknown as DefinitionVersion;

test('panel info names the version a panel copied, and says when the definition changed since', () => {
  expect(definitionLines({ id: 'error-rate', version: 4 }, current)).toEqual({
    heading: 'From Error rate, v4',
    meaning: 'ERROR over START.',
  });
  expect(definitionLines({ id: 'error-rate', version: 3 }, current).note).toContain(
    'This panel keeps v3; ask the agent to rebuild it to use v4.',
  );
  expect(definitionLines({ id: 'error-rate', version: 3 }, undefined).note).toContain('deleted');
});
